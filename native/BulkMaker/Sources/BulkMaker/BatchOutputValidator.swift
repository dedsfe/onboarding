import Foundation

/// Where a new run writes its variations in the output folder.
enum BatchOutputValidator {
    /// Next variation number after the highest `variacao-NN` already in `output`, so a new run
    /// lands next to the previous ones instead of replacing them.
    static func nextFreeIndex(in output: URL) -> Int {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: output.path)) ?? []
        let used = names.compactMap { name -> Int? in
            guard name.hasPrefix("variacao-") else { return nil }
            return Int(name.dropFirst("variacao-".count))
        }
        return (used.max() ?? 0) + 1
    }
}
