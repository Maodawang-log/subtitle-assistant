// These browser-oriented tests need only Node's Web Crypto implementation.
// Do not introduce the global Node type environment into extension compilation.
declare module "node:crypto" {
  export const webcrypto: Crypto;
}
