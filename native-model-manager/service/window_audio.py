"""Strict CDN Range reader. Never downloads a complete remote audio track."""
from __future__ import annotations
import io
import ipaddress
import re
import socket
import time
from urllib.parse import urljoin, urlparse

MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024
ALLOWED_CDN_SUFFIXES = ("bilivideo.com", "bilivideo.cn")
# Observed in the browser for an actual Bilibili DASH audio response (HTTP 206).
# Keep this external CDN entry exact: do not trust arbitrary *.akamaized.net.
ALLOWED_CDN_HOSTS = frozenset({"upos-hz-mirrorakam.akamaized.net"})


class RemoteAudioError(ValueError):
    pass


def validate_audio_url(url, *, resolve=True):
    if not isinstance(url, str) or len(url) > 8192:
        raise RemoteAudioError("Invalid audio URL")
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    approved_host = hostname in ALLOWED_CDN_HOSTS or any(
        hostname.endswith("." + suffix) or hostname == suffix for suffix in ALLOWED_CDN_SUFFIXES)
    if (parsed.scheme != "https" or parsed.username or parsed.password or
            parsed.port not in {None, 443} or parsed.fragment or
            not approved_host):
        raise RemoteAudioError("Only approved HTTPS Bilibili audio CDN URLs are allowed")
    if not resolve:
        return url
    try:
        addresses = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise RemoteAudioError("Audio CDN must resolve only to public IP addresses")
    except socket.gaierror:
        raise RemoteAudioError("Audio CDN DNS lookup failed") from None
    return url


class RangeReader(io.RawIOBase):
    def __init__(self, url, *, trusted_test=False):
        super().__init__()
        import httpx
        self.url = url if trusted_test else validate_audio_url(url)
        self.trusted_test = trusted_test
        self.client = httpx.Client(timeout=httpx.Timeout(15, connect=10), follow_redirects=False, trust_env=False)
        self.pos, self.size, self.downloaded = 0, None, 0
        self.buffer, self.buffer_start = b"", 0
        self.deadline = time.monotonic() + 90
        self._fetch(0, 262143)

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        if whence & 0x10000:  # FFmpeg AVSEEK_SIZE
            return self.size
        if whence == 0:
            target = offset
        elif whence == 1:
            target = self.pos + offset
        elif whence == 2:
            target = self.size + offset
        else:
            raise RemoteAudioError("Invalid audio seek")
        if target < 0:
            raise RemoteAudioError("Negative audio seek")
        self.pos = target
        return target

    def _fetch(self, start, end):
        if time.monotonic() > self.deadline:
            raise RemoteAudioError("Remote audio window download timed out")
        if self.downloaded >= MAX_DOWNLOAD_BYTES:
            raise RemoteAudioError("Remote window exceeds 16 MiB download budget; stopped before full track")
        end = min(end, start + 262143, start + MAX_DOWNLOAD_BYTES - self.downloaded - 1)
        if self.size is not None:
            end = min(end, self.size - 1)
        url = self.url
        try:
            for attempt in range(4):
                with self.client.stream("GET", url, headers={
                    "Range": f"bytes={start}-{end}", "Accept-Encoding": "identity",
                    "Referer": "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0 LocalJapaneseASR/1.0",
                }) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        if self.trusted_test:
                            raise RemoteAudioError("Test reader redirects are disabled")
                        url = validate_audio_url(urljoin(url, response.headers.get("location", "")))
                        continue
                    if response.status_code != 206:
                        raise RemoteAudioError(f"CDN returned HTTP {response.status_code}; bounded Range support is required")
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("content-range", ""))
                    if not match or int(match[1]) != start:
                        raise RemoteAudioError("CDN returned an invalid Content-Range")
                    total, last = int(match[3]), int(match[2])
                    if total > 2 * 1024**3 or last > end or last < start:
                        raise RemoteAudioError("CDN returned an unsafe audio range")
                    if self.size is not None and self.size != total:
                        raise RemoteAudioError("CDN audio changed during download")
                    self.size = total
                    parts, received = [], 0
                    for data in response.iter_bytes(chunk_size=65536):
                        received += len(data)
                        if received > end - start + 1 or self.downloaded + received > MAX_DOWNLOAD_BYTES:
                            raise RemoteAudioError("CDN exceeded the permitted audio range")
                        parts.append(data)
                    if received != last - start + 1:
                        raise RemoteAudioError("CDN returned an incomplete audio range")
                    self.downloaded += received
                    self.buffer_start, self.buffer = start, b"".join(parts)
                    self.url = url
                    return
            raise RemoteAudioError("Too many CDN redirects")
        except RemoteAudioError:
            raise
        except Exception as exc:
            # Do not put signed URLs from transport exceptions into logs/responses.
            raise RemoteAudioError(f"CDN audio request failed ({type(exc).__name__})") from None

    def read(self, size=-1):
        if self.pos >= self.size:
            return b""
        if size < 0:
            size = 262144
        size = min(size, 262144, self.size - self.pos)
        if not self.buffer_start <= self.pos < self.buffer_start + len(self.buffer):
            self._fetch(self.pos, self.pos + max(size, 262144) - 1)
        offset = self.pos - self.buffer_start
        result = self.buffer[offset:offset + size]
        self.pos += len(result)
        return result

    def close(self):
        if hasattr(self, "client"):
            self.client.close()
        super().close()


def decode_window(urls, start, duration, *, trusted_test=False):
    """Seek MP4/DASH audio and decode only the requested <=30s window."""
    import av
    import numpy as np
    error = None
    for url in urls[:4]:
        reader = None
        try:
            reader = RangeReader(url, trusted_test=trusted_test)
            with av.open(reader, mode="r", format="mov", options={"enable_drefs": "0"}) as container:
                stream = container.streams.audio[0]
                if start:
                    container.seek(int(start / float(stream.time_base)), stream=stream, backward=True)
                resampler = av.audio.resampler.AudioResampler(format="fltp", layout="mono", rate=16000)
                pieces = []
                end = start + duration
                for frame in container.decode(stream):
                    if frame.pts is None:
                        raise RemoteAudioError("DASH audio lacks seek timestamps")
                    frame_start = float(frame.pts * frame.time_base)
                    if frame_start > end + .2:
                        break
                    for output in resampler.resample(frame):
                        t = float(output.pts * output.time_base) if output.pts is not None else frame_start
                        data = output.to_ndarray().reshape(-1)
                        left = max(0, int(round((start - t) * 16000)))
                        right = min(len(data), int(round((end - t) * 16000)))
                        if right > left:
                            pieces.append(data[left:right])
                if not pieces:
                    raise RemoteAudioError("No audio in requested video window")
                audio = np.concatenate(pieces)[:int(duration * 16000)].astype(np.float32, copy=False)
                return audio, {"downloaded_bytes": reader.downloaded, "remote_size_bytes": reader.size,
                               "download_budget_bytes": MAX_DOWNLOAD_BYTES, "range_seek": True}
        except RemoteAudioError as exc:
            error = exc
        except Exception as exc:
            error = RemoteAudioError(f"Unable to decode DASH window ({type(exc).__name__})")
        finally:
            if reader:
                reader.close()
    raise error or RemoteAudioError("No audio CDN URLs provided")
