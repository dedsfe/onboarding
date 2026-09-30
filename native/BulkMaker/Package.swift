// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BulkMaker",
    platforms: [.macOS(.v26)],
    products: [
        .executable(name: "BulkMaker", targets: ["BulkMaker"]),
        .executable(name: "carousel-render", targets: ["carousel-render"])
    ],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", exact: "1.11.2")
    ],
    targets: [
        .target(name: "CarouselEngine"),
        .executableTarget(name: "carousel-render", dependencies: ["CarouselEngine"]),
        .executableTarget(name: "BulkMaker", dependencies: ["SwiftTerm", "CarouselEngine"], resources: [.process("Resources")]),
        .testTarget(name: "BulkMakerTests", dependencies: ["BulkMaker", "CarouselEngine"])
    ],
    swiftLanguageModes: [.v5]
)
