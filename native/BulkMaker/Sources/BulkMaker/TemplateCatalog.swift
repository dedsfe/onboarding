import Foundation

struct TemplateInfo: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let categoryLabel: String
    let description: String
    let slideCount: Int
    let aspect: String
    let binds: [String]
    let frames: [TemplateFrame]

    func missingColumns(in document: CSVDocument) -> [String] {
        let headers = Set(document.headers)
        return binds.filter { !headers.contains($0) }
    }
}

struct TemplateFrame: Decodable, Hashable {
    let name: String
    let w: Double
    let h: Double
    let bg: String
    let children: [TemplateText]
}

struct TemplateText: Decodable, Hashable {
    let type: String
    let text: String
    let x: Double
    let y: Double
    let w: Double
    let fontSize: Double
    let fontWeight: Double?
    let color: String
    let lineHeight: Double?
    let letterSpacing: String?
    let textAlign: String?
    let fontStyle: String?
    let bind: String?

    func resolvedText(values: [String: String]) -> String {
        guard let bind, let value = values[bind], !value.isEmpty else { return text }
        return value
    }
}

enum TemplateCatalog {
    static func load() throws -> [TemplateInfo] {
        guard let url = Bundle.module.url(forResource: "templates", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode([TemplateInfo].self, from: Data(contentsOf: url))
    }
}
