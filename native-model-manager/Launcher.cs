using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
class Launcher {
 static void Pump(Stream input,Stream output) {
  byte[] buffer=new byte[65536];int length;
  while((length=input.Read(buffer,0,buffer.Length))>0){output.Write(buffer,0,length);output.Flush();}
 }
 static int Main(string[] args) {
  if(args.Length < 1 || !Regex.IsMatch(args[0], @"^chrome-extension://[a-p]{32}/$")) return 2;
  string folder=AppDomain.CurrentDomain.BaseDirectory;
  string python=File.ReadAllText(Path.Combine(folder,"python-path.txt")).Trim();
  var config=new ProcessStartInfo(python,"\""+Path.Combine(folder,"host.py")+"\" "+args[0]);
  config.WorkingDirectory=folder; config.UseShellExecute=false; config.CreateNoWindow=true;
  config.RedirectStandardInput=true;config.RedirectStandardOutput=true;config.RedirectStandardError=true;
  using(var process=Process.Start(config)) {
   var input=new Thread(()=>{try {Pump(Console.OpenStandardInput(),process.StandardInput.BaseStream);process.StandardInput.Close();}catch{}});input.IsBackground=true;input.Start();
   var error=new Thread(()=>{try {Pump(process.StandardError.BaseStream,Console.OpenStandardError());}catch{}});error.IsBackground=true;error.Start();
   Pump(process.StandardOutput.BaseStream,Console.OpenStandardOutput());process.WaitForExit();return process.ExitCode;
  }
 }
}
