import { addIcon, Modal, normalizePath, Notice, Platform, Plugin, TFile, TFolder, type App, type PaneType, type WorkspaceLeaf } from 'obsidian';
import { TIMELINE_COMMANDS } from './commands';
import { renderEmbed } from './embed';
import { emptyDoc, SAMPLE_COVER, SAMPLE_NOTES, sampleDoc } from './model';
import { formatForExtension, readTimeline, writeTimeline } from './format';
import { NoteCache } from './notes';
import { DEFAULT_SETTINGS, OuroborosSettingTab, type OuroborosSettings } from './settings';
import type { PropValue } from './sync';
import { OuroborosView, linkMatchesPath, VIEW_TYPE } from './view';

// the timeline icon: a line of time with marks on either side
const ICON_SVG = '<path d="M50 9v82M25 28h19M56 50h19M25 72h19" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>';

class ConversionModal extends Modal {
	constructor(app: App, private from: 'ob' | 'evra', private to: 'ob' | 'evra', private create: () => void) { super(app); }
	onOpen() {
		this.setTitle(`Convert ${this.from === 'ob' ? 'Ouroboros Timelines (OB)' : 'Legacy Evra'} to ${this.to === 'ob' ? 'Ouroboros Timelines (OB)' : 'Legacy Evra'}`);
		this.contentEl.createEl('p', { text: `A separate ${this.to === 'ob' ? '.ob' : '.evra'} file will be created. The original ${this.from === 'ob' ? '.ob' : '.evra'} file will remain unchanged.` });
		this.contentEl.createEl('p', { text: 'If the destination name already exists, a numbered copy will be created. No existing timeline will be overwritten.' });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
		buttons.createEl('button', { text: this.to === 'ob' ? 'Create OB Copy' : 'Create Legacy Evra Copy', cls: 'mod-cta' }).onclick = () => { this.close(); this.create(); };
	}
	onClose() { this.contentEl.empty(); }
}

class LegacyPromptModal extends Modal {
	constructor(app: App, private choose: (choice: 'keep' | 'ob') => void) { super(app); }
	onOpen() {
		this.setTitle('Legacy Evra Timeline');
		this.contentEl.createEl('p', { text: 'This timeline uses the legacy Evra format. Ouroboros Timelines supports this format for compatibility, but its native format is OB.' });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Keep Legacy Evra' }).onclick = () => { this.close(); this.choose('keep'); };
		buttons.createEl('button', { text: 'Create OB Copy', cls: 'mod-cta' }).onclick = () => { this.close(); this.choose('ob'); };
	}
	onClose() { this.contentEl.empty(); }
}

export default class OuroborosPlugin extends Plugin {
	settings: OuroborosSettings;
	notes: NoteCache;
	private noteLeaf: WorkspaceLeaf | null = null;
	/** The last timeline properties Ouroboros wrote to each note, and which open timeline wrote them. */
	propWrites = new Map<string, { view: OuroborosView; props: Record<string, PropValue> }>();
	private redrawT = 0;
	private renames: [TFile, string][] = []; // note renames waiting to be applied to closed timelines
	private renamed = new Set<OuroborosView>(); // open views already told about them
	private renameT = 0;

	async onload() {
		await this.loadSettings();
		this.notes = new NoteCache(this.app, () => this.redrawSoon());
		addIcon('ouroboros-timelines', ICON_SVG);

		this.registerView(VIEW_TYPE, (leaf) => new OuroborosView(leaf, this));
		this.registerExtensions(['ob'], VIEW_TYPE);
		if (this.settings.evraCompatibility) this.registerExtensions(['evra'], VIEW_TYPE);
		this.registerHoverLinkSource(VIEW_TYPE, { display: 'Ouroboros Timelines', defaultMod: false });
		this.registerMarkdownCodeBlockProcessor('ob', (src, el, ctx) => renderEmbed(this, src, el, ctx));
		if (this.settings.evraCompatibility) for (const lang of ['evra', 'throughline']) this.registerMarkdownCodeBlockProcessor(lang, (src, el, ctx) => renderEmbed(this, src, el, ctx));
		this.addSettingTab(new OuroborosSettingTab(this.app, this));

		this.addRibbonIcon('ouroboros-timelines', 'New timeline', () => { void this.createTimeline(); });
		this.addCommand({ id: 'new-timeline', name: 'New timeline', callback: () => { void this.createTimeline(); } });
		this.addCommand({ id: 'open-sample', name: 'Open the sample timeline', callback: () => { void this.createSample(); } });
		this.addCommand({
			id: 'convert-evra-to-ob', name: 'Create native file copy from current legacy timeline',
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!(f instanceof TFile) || f.extension !== 'evra' || !this.settings.evraCompatibility) return false;
				if (!checking) void this.convertLegacyTimeline(f);
				return true;
			},
		});
		for (const c of TIMELINE_COMMANDS) {
			this.addCommand({
				id: c.id,
				name: c.name,
				checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(OuroborosView);
					if (!view || !view.timeline) return false;
					if (!checking) view.timeline.run(c.id);
					return true;
				},
			});
		}
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFolder)) return;
			menu.addItem((item) => item.setTitle('New timeline').setIcon('ouroboros-timelines').onClick(() => { void this.createTimeline(file.path); }));
		}));

		// keep cards in step with their notes
		this.registerEvent(this.app.vault.on('modify', (f) => { if (f instanceof TFile && f.extension === 'md') { this.notes.changed(f.path); this.forEachView((v) => { if (v.linksTo(f)) v.timeline?.notesChanged(); }); } }));
		this.registerEvent(this.app.metadataCache.on('changed', (f) => this.forEachView((v) => v.noteChanged(f))));
		this.registerEvent(this.app.vault.on('delete', (f) => { if (f instanceof TFile) { this.notes.changed(f.path); this.forEachView((v) => v.linksChanged()); } }));
		// created files can change where links point; the vault reports every file as created while it loads, so wait for that
		this.app.workspace.onLayoutReady(() => this.registerEvent(this.app.vault.on('create', (f) => { if (f instanceof TFile && f.extension === 'md') this.forEachView((v) => v.linksChanged()); })));
		this.registerEvent(this.app.vault.on('rename', (f, oldPath) => { if (f instanceof TFile && f.extension === 'md') this.noteRenamed(f, oldPath); }));
		this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
			if (!(f instanceof TFile) || f.extension !== 'evra') return;
			const decision = this.settings.evraPromptDecisions[oldPath];
			if (decision) { delete this.settings.evraPromptDecisions[oldPath]; this.settings.evraPromptDecisions[f.path] = decision; void this.saveSettings(); }
		}));
		this.registerEvent(this.app.workspace.on('css-change', () => this.forEachView((v) => v.timeline?.cssChanged())));
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => { if (leaf && leaf.view instanceof OuroborosView) leaf.view.timeline?.focus(); }));
	}

	onunload() {
		window.clearTimeout(this.redrawT);
		if (this.renames.length) { window.clearTimeout(this.renameT); void this.renamesDone(); } // closed timelines still follow
		this.noteLeaf = null;
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<OuroborosSettings> | null;
		let migrated: Partial<OuroborosSettings> | null = null;
		try {
			const adapter = this.app.vault.adapter as unknown as { exists?: (path: string) => Promise<boolean>; read?: (path: string) => Promise<string> };
			const legacyPath = `${this.app.vault.configDir}/plugins/evra/data.json`;
			if (!data && adapter.exists && adapter.read && await adapter.exists(legacyPath)) {
				const old: unknown = JSON.parse(await adapter.read(legacyPath));
				if (old && typeof old === 'object' && !Array.isArray(old)) migrated = { ...old };
			}
		} catch { /* malformed or inaccessible legacy settings are ignored safely */ }
		this.settings = { ...DEFAULT_SETTINGS, ...(migrated || {}), ...(data || {}) };
		if (data?.evraCompatibility === undefined) this.settings.evraCompatibility = true;
		if (migrated && !data) await this.saveSettings();
	}
	async saveSettings() { await this.saveData(this.settings); }
	showLegacyPrompt(file: TFile) {
		if (!this.settings.evraCompatibility || file.extension !== 'evra' || this.settings.evraPromptDecisions[file.path]) return;
		new LegacyPromptModal(this.app, (choice) => {
			this.settings.evraPromptDecisions[file.path] = choice;
			void this.saveSettings();
			if (choice === 'ob') void this.convertTimeline(file, 'ob');
		}).open();
	}

	private forEachView(fn: (v: OuroborosView) => void) {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => { if (l.view instanceof OuroborosView) fn(l.view); });
	}
	private redrawSoon() {
		window.clearTimeout(this.redrawT);
		this.redrawT = window.setTimeout(() => this.forEachView((v) => v.timeline?.notesChanged()), 80);
	}

	/** A note was renamed: update cards in open timelines now, and in timeline files that aren't open once the burst is over
	    (moving a folder renames every note in it, one event each: each closed timeline is then read and written once). */
	private noteRenamed(file: TFile, oldPath: string) {
		this.notes.renamed(oldPath);
		const w = this.propWrites.get(oldPath);
		if (w) { this.propWrites.delete(oldPath); this.propWrites.set(file.path, w); }
		this.forEachView((v) => { v.noteRenamed(file, oldPath); this.renamed.add(v); });
		this.renames.push([file, oldPath]);
		window.clearTimeout(this.renameT);
		this.renameT = window.setTimeout(() => { void this.renamesDone(); }, 60);
	}

	private async renamesDone() {
		const batch = this.renames, told = this.renamed;
		this.renames = []; this.renamed = new Set();
		const open = new Set<string>();
		this.forEachView((v) => {
			if (v.file) open.add(v.file.path);
			if (!told.has(v)) batch.forEach(([f, old]) => v.noteRenamed(f, old)); // opened from disk after the renames began
			v.renamesDone();
		});
		// every link to a note, and its path in the synced-notes list, contains its old name; as JSON it may be escaped
		const needles = batch.flatMap(([, old]) => { const base = old.split('/').pop().replace(/\.md$/, ''); return [base, JSON.stringify(base).slice(1, -1)]; });
		const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');
		for (const f of this.app.vault.getFiles()) {
			if (!['evra', 'ob'].includes(f.extension) || open.has(f.path)) continue;
			if (f.extension === 'evra' && !this.settings.evraCompatibility) continue;
			let text: string;
			try { text = await this.app.vault.cachedRead(f); } catch { continue; }
			if (!needles.some((n) => text.includes(n))) continue; // skip the read-and-parse for timelines that can't mention them
			await this.app.vault.process(f, (data) => {
			let doc: { events?: { file?: string | null }[]; opts?: { sync?: { notes?: string[] } } };
				const fileFormat = formatForExtension(f.extension);
				if (!fileFormat) return data;
				try { doc = readTimeline(JSON.parse(data), f.basename, fileFormat); } catch { return data; } // unreadable or unsupported: leave it as it is
				if (!doc || typeof doc !== 'object') return data;
				let changed = false;
				const here = dirOf(f.path);
				for (const [file, oldPath] of batch) {
					const link = this.app.metadataCache.fileToLinktext(file, f.path, true);
					(Array.isArray(doc.events) ? doc.events : []).forEach((e) => {
						if (!e || !e.file || !linkMatchesPath(e.file, oldPath) || e.file === link) return;
						// Did this link point at the moved note before the move? A link naming the full old path did. A shorter one
						// (a bare name) may now resolve to another note with the same name; it only pointed at that other note
						// before if Obsidian would have preferred it then: it sits beside the timeline and the old note didn't.
						// When unsure, keep the card on the note it was showing: the one that moved.
						const now = this.app.metadataCache.getFirstLinkpathDest(e.file, f.path);
						const otherWon = now && now !== file && dirOf(now.path) === here && dirOf(oldPath) !== here;
						const fullPath = e.file.split('|')[0].split('#')[0].replace(/\.md$/, '') === oldPath.replace(/\.md$/, '');
						if (fullPath || !otherWon) { e.file = link; changed = true; }
					});
					// as the open view does: the list of notes carrying synced properties follows the rename
					const sn = doc.opts && doc.opts.sync && doc.opts.sync.notes;
					if (Array.isArray(sn) && sn.includes(oldPath)) { doc.opts.sync.notes = sn.map((p) => (p === oldPath ? file.path : p)); changed = true; }
				}
				return changed ? writeTimeline(doc as import('./types').TimelineDoc, fileFormat) : data;
			});
		}
	}

	/** Open a note beside the timeline, reusing the pane opened last time. */
	async openInSideLeaf(file: TFile, from: WorkspaceLeaf, mod: boolean | PaneType) {
		const ws = this.app.workspace;
		let leaf: WorkspaceLeaf = null;
		if (mod) leaf = ws.getLeaf(mod);
		else if (this.settings.openNotesIn === 'split' && !Platform.isPhone) {
			let alive = false;
			ws.iterateRootLeaves((l) => { if (l === this.noteLeaf) alive = true; });
			const prev = alive ? this.noteLeaf : null;
			leaf = prev && prev !== from && prev.view.getViewType() === 'markdown' ? prev : ws.createLeafBySplit(from, 'vertical');
			this.noteLeaf = leaf;
		} else leaf = ws.getLeaf(this.settings.openNotesIn === 'same' ? false : 'tab');
		await leaf.openFile(file);
	}

	/** Dragged from the file explorer, a search result or a link. */
	filesFromDrop(e: DragEvent): TFile[] {
		const dm = (this.app as unknown as { dragManager?: { draggable?: { type?: string; file?: unknown; files?: unknown[] } } }).dragManager;
		const d = dm && dm.draggable;
		const md = (f: unknown): f is TFile => f instanceof TFile && f.extension === 'md';
		if (d && d.type === 'file' && md(d.file)) return [d.file];
		if (d && d.type === 'files' && Array.isArray(d.files)) return d.files.filter(md);
		const txt = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
		const out: TFile[] = [];
		for (const line of txt.split(/\r?\n/)) {
			// only the obsidian:// ?file= value is URL-encoded; a wikilink like [[100% done]] is taken as written
			let link = /\[\[([^\]|#]+)/.exec(line)?.[1];
			if (!link) {
				const enc = /[?&]file=([^&]+)/.exec(line)?.[1];
				if (enc) try { link = decodeURIComponent(enc); } catch { link = enc; }
			}
			if (!link) continue;
			const f = this.app.metadataCache.getFirstLinkpathDest(link, '');
			if (md(f)) out.push(f);
		}
		return out;
	}

	private async uniquePath(folder: string, name: string, ext: string) {
		// no leading dots (a hidden file the vault never lists), no trailing dots or spaces (invalid on Windows),
		// and short enough to leave room for the folder, a " 2" suffix and the extension
		const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, '').trim().replace(/^\.+/, '').slice(0, 150).replace(/[. ]+$/, '').trim() || 'Untitled';
		const base = normalizePath(folder ? `${folder}/${clean}` : clean);
		let path = `${base}.${ext}`, k = 2;
		while (this.app.vault.getAbstractFileByPath(path)) path = `${base} ${k++}.${ext}`;
		return path;
	}
	private async ensureFolder(folder: string) {
		if (folder && !this.app.vault.getAbstractFileByPath(normalizePath(folder))) await this.app.vault.createFolder(normalizePath(folder));
	}

	async createNoteFile(folder: string, title: string, text: string, raw = false): Promise<TFile | null> {
		try {
			await this.ensureFolder(folder);
			const path = await this.uniquePath(folder, title, 'md');
			return await this.app.vault.create(path, raw ? text : text ? text + '\n' : '');
		} catch (err) {
			new Notice('Couldn’t create the note. ' + String(err));
			return null;
		}
	}

	/** A new, empty timeline in the given folder (or the one in the settings), opened in a new tab. */
	async createTimeline(folder?: string) {
		const dir = folder ?? (this.settings.newFileFolder.trim() || this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path || '').path);
		const at = dir === '/' ? '' : dir;
		await this.ensureFolder(at);
		const path = await this.uniquePath(at, 'Untitled timeline', 'ob');
		const name = path.split('/').pop().replace(/\.ob$/, '');
		const doc = emptyDoc(name, this.settings.defaults);
		const f = await this.app.vault.create(path, writeTimeline(doc, 'ob'));
		await this.app.workspace.getLeaf('tab').openFile(f);
	}

	/** The Chronicle of Veld: a sample timeline with its notes, in its own folder. */
	async createSample() {
		const folder = 'Ouroboros sample';
		const existing = this.app.vault.getAbstractFileByPath(`${folder}/Chronicle of Veld.ob`);
		if (existing instanceof TFile) { await this.app.workspace.getLeaf('tab').openFile(existing); return; }
		await this.ensureFolder(folder);
		for (const [name, text] of Object.entries(SAMPLE_NOTES)) {
			const p = `${folder}/${name}.md`;
			if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.create(p, text);
		}
		if (!this.app.vault.getAbstractFileByPath(`${folder}/The Heron.svg`)) await this.app.vault.create(`${folder}/The Heron.svg`, SAMPLE_COVER);
		// link each card to the sample's own note, even when the vault has another note with the same name
		const evraPath = `${folder}/Chronicle of Veld.ob`, mc = this.app.metadataCache;
		const link = (name: string) => {
			const note = this.app.vault.getAbstractFileByPath(`${folder}/${name}.md`);
			if (!(note instanceof TFile)) return `${folder}/${name}`;
			const text = mc.fileToLinktext(note, evraPath, true);
			return mc.getFirstLinkpathDest(text, evraPath) === note ? text : `${folder}/${name}`; // the full path if the short one is taken
		};
		const f = await this.app.vault.create(evraPath, writeTimeline(sampleDoc(link), 'ob'));
		await this.app.workspace.getLeaf('tab').openFile(f);
		new Notice('Opened the sample timeline. Its notes are in the sample folder next to it.');
	}

	/** Create a separate native copy of a legacy timeline; the source is never modified. */
	async convertLegacyTimeline(file: TFile): Promise<TFile | null> {
		return this.convertTimeline(file, 'ob');
	}

	async convertTimeline(file: TFile, target: 'ob' | 'evra'): Promise<TFile | null> {
		if (target === 'evra' && !this.settings.evraCompatibility) { new Notice('Enable legacy Evra compatibility to create Evra timelines.'); return null; }
		if (formatForExtension(file.extension) === target) return file;
		const source = formatForExtension(file.extension);
		if (!source) return null;
		new ConversionModal(this.app, source, target, () => { void this.createConvertedCopy(file, source, target); }).open();
		return null;
	}

	private async createConvertedCopy(file: TFile, source: 'ob' | 'evra', target: 'ob' | 'evra'): Promise<TFile | null> {
		try {
			const doc = readTimeline(JSON.parse(await this.app.vault.read(file)), file.basename, source);
			const path = await this.uniquePath(file.parent?.path === '/' ? '' : file.parent?.path || '', file.basename, target);
			const text = writeTimeline(doc, target);
			readTimeline(JSON.parse(text), file.basename, target);
			const copy = await this.app.vault.create(path, text);
			new Notice(`Created ${target === 'ob' ? 'native OB' : 'Legacy Evra'} copy: ${copy.path}`);
			await this.app.workspace.getLeaf('tab').openFile(copy);
			return copy;
		} catch (e) {
			new Notice(`Couldn’t convert “${file.basename}”: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}
}
