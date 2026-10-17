import AppKit
import CarouselEngine
import SwiftUI

struct CalendarPostHost: View {
    var body: some View {
        let center = CalendarPostCenter.shared
        ZStack {
            if let request = center.request {
                CalendarPostComposer(request: request, center: center).id(request.id)
            }
        }
        .onChange(of: center.store.current.id) { _, _ in center.request = nil }
    }
}

/// One carousel, reviewed in slide order, before anything is written to the posting calendar.
struct CalendarPostComposer: View {
    let request: CalendarPostCenter.Request
    let center: CalendarPostCenter
    var onControlFrame: ((String, CGRect) -> Void)?
    @State private var slides: [URL]
    @State private var date: Date
    @State private var caption = ""
    @State private var saving = false
    @State private var error: String?
    @State private var picker: InputPickerLibrary?
    @State private var pickerRequest: InputPickerCenter.Request?

    init(request: CalendarPostCenter.Request, center: CalendarPostCenter,
         onControlFrame: ((String, CGRect) -> Void)? = nil) {
        self.request = request
        self.center = center
        self.onControlFrame = onControlFrame
        _slides = State(initialValue: request.files)
        let agenda = (try? PostAgenda.load(from: request.agendaFile)) ?? PostAgenda()
        _date = State(initialValue: CalendarPostImport.suggestedDate(agenda: agenda))
    }

    var body: some View {
        GeometryReader { geometry in
            let width = min(780, max(320, geometry.size.width - 48))
            let height = min(650, max(320, geometry.size.height - 48))
            ZStack {
                Color.black.opacity(0.3).ignoresSafeArea().onTapGesture(perform: dismiss)
                VStack(spacing: 0) {
                    header
                    ScrollView {
                        VStack(alignment: .leading, spacing: 22) {
                            DatePicker("Data e horário", selection: $date, displayedComponents: [.date, .hourAndMinute])
                                .datePickerStyle(.field).font(.system(size: 13, weight: .medium))
                                .environment(\.locale, Locale(identifier: "pt_BR"))
                                .reportPostControl("date", to: onControlFrame)
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Legenda").font(.system(size: 13, weight: .medium))
                                TextField("", text: $caption,
                                          prompt: Text("Escreva uma legenda, se quiser").foregroundStyle(.white.opacity(0.6)), axis: .vertical)
                                    .textFieldStyle(.plain).lineLimit(2...4).modalField()
                                    .accessibilityLabel("Legenda do post")
                            }
                            HStack {
                                Text("Slides").font(.system(size: 14, weight: .semibold))
                                Spacer()
                                Menu {
                                    Button("Do Mac…", systemImage: "laptopcomputer", action: chooseMac)
                                    Button("Do canvas…", systemImage: "square.dashed", action: chooseCanvas)
                                } label: { Label("Adicionar imagens", systemImage: "plus") }
                                .menuStyle(.button).buttonStyle(.appSecondary).controlSize(.small)
                                .reportPostControl("add-images", to: onControlFrame)
                            }
                            if slides.isEmpty {
                                VStack(spacing: 10) {
                                    Image(systemName: "photo.on.rectangle").font(.system(size: 26, weight: .light))
                                    Text("Escolha as imagens do carrossel").font(.system(size: 14, weight: .medium))
                                    Text("Adicione do Mac ou selecione no canvas.")
                                        .font(.system(size: 12)).foregroundStyle(.white.opacity(0.65))
                                }
                                .frame(maxWidth: .infinity).padding(.vertical, 36)
                            } else {
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120, maximum: 180), spacing: 16)], alignment: .leading, spacing: 18) {
                                    ForEach(Array(slides.enumerated()), id: \.element) { index, file in
                                        slide(file, index: index)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 24).padding(.bottom, 12)
                    }
                    .scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
                    .disabled(saving || picker != nil)
                    footer(compact: width < 540)
                }
                .frame(width: width, height: height)
                .modalPanel()
                .reportPostControl("panel", to: onControlFrame)
                if let picker, let pickerRequest {
                    InputSourcePicker(request: pickerRequest, store: center.store, library: picker,
                                      initialSourceTab: 1, actionTitle: "Usar no carrossel", selectionCompletion: { chosen in
                        slides = CalendarPostImport.updating(slides, with: chosen)
                    }, close: { self.picker = nil; self.pickerRequest = nil })
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .coordinateSpace(name: "calendar-post")
        }
        .onExitCommand { if picker == nil { dismiss() } }
        .task {
            switch request.source {
            case .mac: chooseMac()
            case .canvas: chooseCanvas()
            case .selection: break
            }
        }
    }

    private var header: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Adicionar ao calendário").font(.system(size: 20, weight: .semibold))
                Text("Um carrossel, na ordem que você escolher.")
                    .font(.system(size: 13)).foregroundStyle(.white.opacity(0.65))
            }
            Spacer()
            Button(action: dismiss) {
                Image(systemName: "xmark")
            }
            .buttonStyle(.appIcon).disabled(saving || picker != nil)
            .accessibilityLabel("Fechar novo post")
            .reportPostControl("close", to: onControlFrame)
        }
        .padding(24)
    }

    private func slide(_ file: URL, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SourceThumbnail(url: file).aspectRatio(1, contentMode: .fit).clipShape(.rect(cornerRadius: 12))
            HStack(spacing: 4) {
                Text("\(index + 1)").font(.system(size: 12, weight: .semibold)).monospacedDigit()
                Spacer(minLength: 0)
                Button { move(index, by: -1) } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(.appIcon).controlSize(.small)
                    .disabled(index == 0).help("Mover para antes").accessibilityLabel("Antecipar slide \(index + 1)")
                    .reportPostControl("previous-\(index)", to: onControlFrame)
                Button { move(index, by: 1) } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(.appIcon).controlSize(.small)
                    .disabled(index == slides.count - 1).help("Mover para depois").accessibilityLabel("Adiar slide \(index + 1)")
                    .reportPostControl("next-\(index)", to: onControlFrame)
                Button { if slides.indices.contains(index) { slides.remove(at: index) } } label: { Image(systemName: "xmark") }
                    .buttonStyle(.appIcon).controlSize(.small)
                    .help("Remover do carrossel").accessibilityLabel("Remover slide \(index + 1)")
                    .reportPostControl("remove-\(index)", to: onControlFrame)
            }
            .font(.system(size: 11, weight: .medium))
        }
    }

    private var actions: some View {
        HStack(spacing: 12) {
            Button("Cancelar", action: dismiss).buttonStyle(.appSecondary)
                .keyboardShortcut(.cancelAction).disabled(saving || picker != nil)
                .reportPostControl("cancel", to: onControlFrame)
            Button(action: save) {
                HStack(spacing: 8) {
                    if saving { ProgressView().controlSize(.small) }
                    Text(saving ? "Adicionando…" : "Adicionar")
                }
            }
            .buttonStyle(.appPrimary)
            .keyboardShortcut(.defaultAction).disabled(slides.isEmpty || saving || picker != nil)
            .reportPostControl("save", to: onControlFrame)
        }
    }

    private func footer(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let error { Text(error).font(.system(size: 12)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            let count = Text("\(slides.count) \(slides.count == 1 ? "slide" : "slides") · 1 post")
                .font(.system(size: 13, weight: .semibold)).monospacedDigit()
            if compact {
                count
                HStack { Spacer(); actions }
            } else {
                HStack { count; Spacer(); actions }
            }
        }
        .padding(24)
    }

    private func move(_ index: Int, by delta: Int) {
        let target = index + delta
        guard slides.indices.contains(target) else { return }
        slides.swapAt(index, target)
    }

    private func chooseMac() {
        guard !saving else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.image, .pdf]
        panel.prompt = "Adicionar"
        panel.message = "Escolha imagens ou uma pasta para este carrossel."
        panel.begin { response in
            guard response == .OK else { return }
            Task { @MainActor in
                let incoming = CalendarPostImport.images(in: panel.urls)
                slides = CalendarPostImport.updating(slides, with: slides + incoming.filter { !slides.contains($0) })
                if incoming.isEmpty { error = "Não encontrei imagens nos arquivos selecionados." }
            }
        }
    }

    private func chooseCanvas() {
        guard !saving else { return }
        let canvas = InputPickerLibrary.imageItems(CanvasBoard.savedItems(in: request.project.canvasDirectory))
        let selected = Set(slides.map { $0.standardizedFileURL.path })
        let canvasPaths = Set(canvas.map { $0.url.standardizedFileURL.path })
        let sources = InputSources(files: slides.filter { !canvasPaths.contains($0.standardizedFileURL.path) }.map(\.path),
                                   canvasItems: canvas.filter { selected.contains($0.url.standardizedFileURL.path) }.map(\.item.id))
        picker = InputPickerLibrary(kind: .photos, sources: sources, canvas: canvas)
        pickerRequest = .init(kind: .photos, completion: { _ in })
    }

    private func dismiss() { if !saving { center.request = nil } }

    private func save() {
        guard !saving, !slides.isEmpty else { return }
        saving = true
        error = nil
        let files = slides, text = caption, chosenDate = date, project = request.project
        Task {
            let result = await Task.detached(priority: .userInitiated) {
                Result { try CalendarPostImport.prepare(files, caption: text, in: project.folder) }
            }.value
            do {
                let folder = try result.get()
                do {
                    guard center.store.current.id == project.id, center.request?.id == request.id else {
                        throw CalendarPostImport.ImportError.projectChanged
                    }
                    let post = try CalendarPostImport.commit(folder: folder, date: chosenDate, caption: text, to: request.agendaFile)
                    center.finish(post)
                } catch {
                    try? FileManager.default.removeItem(at: folder)
                    throw error
                }
            } catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}

private extension View {
    func reportPostControl(_ id: String, to report: ((String, CGRect) -> Void)?) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .named("calendar-post")) } action: { report?(id, $0) }
    }
}
