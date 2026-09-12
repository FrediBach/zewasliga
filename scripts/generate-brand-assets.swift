// Regenerate the checked-in PNG assets on macOS: swift scripts/generate-brand-assets.swift
import AppKit

let paper = NSColor(srgbRed: 242/255, green: 241/255, blue: 235/255, alpha: 1)
let ink = NSColor(srgbRed: 37/255, green: 39/255, blue: 34/255, alpha: 1)
let accent = NSColor(srgbRed: 199/255, green: 71/255, blue: 40/255, alpha: 1)
let muted = NSColor(srgbRed: 85/255, green: 88/255, blue: 79/255, alpha: 1)
func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ color: NSColor) {
    color.setFill()
    NSBezierPath(rect: NSRect(x: x, y: y, width: w, height: h)).fill()
}
func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ color: NSColor, mono: Bool = false) {
    let font = NSFont(name: mono ? "Courier New" : "Arial", size: size)!
    (value as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [.font: font, .foregroundColor: color])
}
func render(_ name: String, _ width: Int, _ height: Int, _ draw: () -> Void) {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "public/\(name)"))
}
for size in [32, 180, 192, 512] {
    render(size == 180 ? "apple-touch-icon.png" : "icon-\(size).png", size, size) {
        let scale = CGFloat(size) / 64
        let transform = NSAffineTransform()
        transform.scale(by: scale)
        transform.concat()
        rect(0, 0, 64, 64, paper)
        ink.setFill()
        let z = NSBezierPath()
        z.move(to: NSPoint(x: 13, y: 50)); z.line(to: NSPoint(x: 48, y: 50))
        z.line(to: NSPoint(x: 48, y: 43)); z.line(to: NSPoint(x: 24, y: 21))
        z.line(to: NSPoint(x: 39, y: 21)); z.line(to: NSPoint(x: 39, y: 14))
        z.line(to: NSPoint(x: 13, y: 14)); z.line(to: NSPoint(x: 13, y: 21))
        z.line(to: NSPoint(x: 37, y: 43)); z.line(to: NSPoint(x: 13, y: 43)); z.close(); z.fill()
        rect(43, 14, 8, 8, accent)
    }
}
render("og-image.png", 1200, 630) {
    rect(0, 0, 1200, 630, paper)
    text("A LOCAL IMAGE SLIDESHOW", 72, 550, 14, muted, mono: true)
    text("Zewasliga", 67, 392, 108, ink)
    let wordmarkWidth = ("Zewasliga" as NSString).size(withAttributes: [.font: NSFont(name: "Arial", size: 108)!]).width
    text(".", 67 + wordmarkWidth, 392, 108, accent)
    text("Every photo.", 72, 278, 48, ink)
    text("Room to be seen.", 72, 220, 48, ink)
    // A restrained diagram of the full-frame mosaic.
    rect(846, 226, 158, 258, ink)
    rect(1012, 359, 116, 125, accent)
    rect(1012, 226, 116, 125, muted)
    rect(72, 155, 1056, 1, muted)
    text("On your device. No uploads.", 72, 104, 18, muted)
    text("WWW.ZEWASLIGA.COM", 889, 107, 14, muted, mono: true)
}

// ICO container with the 32px PNG for browsers that request /favicon.ico.
let faviconPNG = try! Data(contentsOf: URL(fileURLWithPath: "public/icon-32.png"))
var ico = Data([0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0])
for value in [UInt32(faviconPNG.count), UInt32(22)] {
    ico.append(contentsOf: (0..<4).map { UInt8((value >> ($0 * 8)) & 255) })
}
ico.append(faviconPNG)
try! ico.write(to: URL(fileURLWithPath: "public/favicon.ico"))
