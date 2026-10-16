import AppKit

let size = NSSize(width: 660, height: 420)
let image = NSImage(size: size)
image.lockFocus()
NSColor(calibratedRed: 0.97, green: 0.98, blue: 0.96, alpha: 1).setFill()
NSRect(origin: .zero, size: size).fill()
func centered(_ text: String, y: CGFloat, font: NSFont, color: NSColor) {
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let string = NSAttributedString(string: text, attributes: attributes)
    string.draw(at: NSPoint(x: (size.width - string.size().width) / 2, y: y))
}
let ink = NSColor(calibratedRed: 0.15, green: 0.19, blue: 0.15, alpha: 1)
centered("The Carousel Maker", y: 352, font: .systemFont(ofSize: 26, weight: .semibold), color: ink)
centered("Arraste o app para Aplicativos", y: 58, font: .systemFont(ofSize: 17), color: ink)
centered("Depois, abra pela pasta Aplicativos.", y: 31, font: .systemFont(ofSize: 13), color: ink)
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
