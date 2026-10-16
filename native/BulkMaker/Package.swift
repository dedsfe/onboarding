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
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", exact: "1.11.2"),
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0")
    ],
    targets: [
        .target(name: "CarouselEngine"),
        .executableTarget(name: "carousel-render", dependencies: ["CarouselEngine"]),
        .executableTarget(name: "BulkMaker", dependencies: ["SwiftTerm", "CarouselEngine", .product(name: "Sparkle", package: "Sparkle")],
                          resources: [.process("Resources")],
                          linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
        .testTarget(name: "BulkMakerTests", dependencies: ["BulkMaker", "CarouselEngine"])
    ],
    swiftLanguageModes: [.v5]
)
