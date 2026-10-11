// The qrcode package ships no types; PromoQr.tsx uses only this.
declare module "qrcode" {
  export function toString(text: string, options?: Record<string, unknown>): Promise<string>;
  const QRCode: { toString: typeof toString };
  export default QRCode;
}
