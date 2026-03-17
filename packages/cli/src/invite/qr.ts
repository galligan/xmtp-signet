import QRCode from "qrcode";

/**
 * Render a QR code to the terminal using ANSI escape codes.
 * Works in iTerm2, Terminal.app, VS Code terminal, etc.
 */
export async function renderQrToTerminal(data: string): Promise<string> {
  return QRCode.toString(data, {
    type: "terminal",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}

/**
 * Generate a QR code as a base64-encoded PNG data URL.
 * Useful for --json output or embedding in HTML.
 */
export async function renderQrToDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });
}
