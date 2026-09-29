import Foundation

struct CSVDocument {
    let headers: [String]
    let rows: [[String]]

    enum ParseError: LocalizedError {
        case empty
        case duplicateHeader(String)
        case missingHeader
        case unclosedQuote

        var errorDescription: String? {
            switch self {
            case .empty: return "O CSV não contém dados."
            case .duplicateHeader(let name): return "A coluna \"\(name)\" aparece mais de uma vez."
            case .missingHeader: return "Todas as colunas precisam ter um nome."
            case .unclosedQuote: return "Há aspas abertas no CSV."
            }
        }
    }

    init(text: String) throws {
        let source = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        let delimiter = Self.delimiter(in: source)
        var records: [[String]] = []
        var record: [String] = []
        var field = ""
        var inQuotes = false
        // UnicodeScalar keeps CR and LF separate (Swift Character treats CRLF as one grapheme).
        let characters = Array(source.unicodeScalars)
        var index = 0

        func appendRecord() {
            record.append(field.trimmingCharacters(in: .whitespaces))
            field = ""
            if record.contains(where: { !$0.isEmpty }) { records.append(record) }
            record = []
        }

        while index < characters.count {
            let character = characters[index]
            if character == "\"" {
                if inQuotes && index + 1 < characters.count && characters[index + 1] == "\"" {
                    field.append("\"")
                    index += 1
                } else {
                    inQuotes.toggle()
                }
            } else if character == delimiter && !inQuotes {
                record.append(field.trimmingCharacters(in: .whitespaces))
                field = ""
            } else if (character == "\n" || character == "\r") && !inQuotes {
                appendRecord()
                if character == "\r" && index + 1 < characters.count && characters[index + 1] == "\n" { index += 1 }
            } else {
                field.unicodeScalars.append(character)
            }
            index += 1
        }

        guard !inQuotes else { throw ParseError.unclosedQuote }
        if !field.isEmpty || !record.isEmpty { appendRecord() }
        guard let first = records.first, records.count > 1 else { throw ParseError.empty }

        let names = first.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard names.allSatisfy({ !$0.isEmpty }) else { throw ParseError.missingHeader }
        var seen = Set<String>()
        for name in names {
            guard seen.insert(name.lowercased()).inserted else { throw ParseError.duplicateHeader(name) }
        }
        headers = names
        rows = records.dropFirst().map { row in
            Array((row + Array(repeating: "", count: max(0, names.count - row.count))).prefix(names.count))
        }
    }

    private static func delimiter(in text: String) -> Unicode.Scalar {
        var commaCount = 0
        var semicolonCount = 0
        var inQuotes = false
        let characters = Array(text.unicodeScalars)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if character == "\"" {
                if inQuotes && index + 1 < characters.count && characters[index + 1] == "\"" { index += 1 }
                else { inQuotes.toggle() }
            } else if !inQuotes {
                if character == "\n" || character == "\r" { break }
                if character == "," { commaCount += 1 }
                if character == ";" { semicolonCount += 1 }
            }
            index += 1
        }
        return semicolonCount > commaCount ? ";" : ","
    }
}
