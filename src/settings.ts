import { Notice, PluginSettingTab, Setting, type App, type SettingDefinitionItem } from 'obsidian';
import type OuroborosPlugin from './main';
import type { TimelineDefaults } from './types';

export interface OuroborosSettings {
	/** Where new timelines go. Empty: Obsidian's setting for new notes. */
	newFileFolder: string;
	/** Where "Convert to note" puts new notes. Empty: next to the timeline. */
	noteFolder: string;
	openNotesIn: 'split' | 'tab' | 'same';
	/** The starting calendar, formats, colors and card options for new timelines. */
	defaults: TimelineDefaults | null;
	/** Recognise and edit legacy Evra timelines. */
	evraCompatibility: boolean;
}

/** @deprecated Use OuroborosSettings. */
export type EvraSettings = OuroborosSettings;

export const DEFAULT_SETTINGS: OuroborosSettings = { newFileFolder: '', noteFolder: '', openNotesIn: 'split', defaults: null, evraCompatibility: true };

/* Settings for the plugin as a whole. Each timeline's own calendar, formats and colors are in its settings panel. */
const TEXT = {
	newFolder: ['Folder for new timelines', 'Leave empty to use the same place as new notes.'],
	noteFolder: ['Folder for notes made from cards', 'Where a card’s new note goes when you convert it. Leave empty to put it next to the timeline.'],
	openIn: ['Open linked notes', 'Where a card’s note opens. Hold the modifier key while clicking to open it in a new tab instead.'],
	sample: ['Sample timeline', 'A small world with eras, spans and linked notes to explore. It goes in its own folder.'],
} as const;
const OPEN_IN = { split: 'Beside the timeline', tab: 'In a new tab', same: 'In place of the timeline' };

export class OuroborosSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: OuroborosPlugin) { super(app, plugin); }

	private startingDesc(): string {
		const d = this.plugin.settings.defaults;
		return d
			? `New timelines start with a saved calendar of ${d.cal.months.length} months, ${d.palette.length} colors and your card options. To change them, open a timeline, then Timeline settings → Timeline → Defaults.`
			: 'New timelines start with a 12-month calendar. To use another, set it up in a timeline, then choose Timeline settings → Timeline → “Use these settings for new timelines”.';
	}

	/** Obsidian 1.13 and later draw the tab from these, and can search them; display() below is for older versions. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ type: 'group', heading: 'Files', items: [
				{ name: TEXT.newFolder[0], desc: TEXT.newFolder[1], control: { type: 'folder', key: 'newFileFolder', placeholder: 'Timelines' } },
				{ name: TEXT.noteFolder[0], desc: TEXT.noteFolder[1], control: { type: 'folder', key: 'noteFolder', placeholder: 'Next to the timeline' } },
				{ name: TEXT.openIn[0], desc: TEXT.openIn[1], control: { type: 'dropdown', key: 'openNotesIn', options: OPEN_IN } },
			] },
			{ type: 'group', heading: 'New timelines', items: [
				{ name: 'Starting settings', aliases: ['defaults', 'calendar'], render: (st) => {
					st.setDesc(this.startingDesc()).addButton((b) => b.setButtonText('Forget saved settings').setDisabled(!this.plugin.settings.defaults)
						.onClick(async () => { this.plugin.settings.defaults = null; await this.plugin.saveSettings(); st.setDesc(this.startingDesc()); b.setDisabled(true); }));
				} },
				{ name: TEXT.sample[0], desc: TEXT.sample[1], render: (st) => { st.addButton((b) => b.setButtonText('Open the sample').onClick(() => { void this.plugin.createSample(); })); } },
			] },
			{ type: 'group', heading: 'File format compatibility', items: [
				{ name: 'Enable Evra compatibility', desc: 'Allow Ouroboros Timelines to recognise, open and edit legacy Evra .evra timeline files.', control: { type: 'toggle', key: 'evraCompatibility' } },
			] },
		];
	}

	setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		if (key === 'newFileFolder' || key === 'noteFolder') s[key] = typeof value === 'string' ? value.trim() : '';
		else if (key === 'openNotesIn' && typeof value === 'string' && value in OPEN_IN) s.openNotesIn = value as OuroborosSettings['openNotesIn'];
		else if (key === 'evraCompatibility' && typeof value === 'boolean') s.evraCompatibility = value;
		return this.plugin.saveSettings();
	}

	display(): void { this.render(); }

	private render(): void {
		const { containerEl } = this, s = this.plugin.settings;
		containerEl.empty();
		new Setting(containerEl).setName('Files').setHeading();
		new Setting(containerEl)
			.setName(TEXT.newFolder[0])
			.setDesc(TEXT.newFolder[1])
			.addText((t) => t.setPlaceholder('Timelines').setValue(s.newFileFolder).onChange(async (v) => { s.newFileFolder = v.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl)
			.setName(TEXT.noteFolder[0])
			.setDesc(TEXT.noteFolder[1])
			.addText((t) => t.setPlaceholder('Next to the timeline').setValue(s.noteFolder).onChange(async (v) => { s.noteFolder = v.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl)
			.setName(TEXT.openIn[0])
			.setDesc(TEXT.openIn[1])
			.addDropdown((d) => d
				.addOptions(OPEN_IN)
				.setValue(s.openNotesIn)
				.onChange(async (v) => { s.openNotesIn = v as OuroborosSettings['openNotesIn']; await this.plugin.saveSettings(); }));

		new Setting(containerEl).setName('New timelines').setHeading();
		new Setting(containerEl)
			.setName('Starting settings')
			.setDesc(this.startingDesc())
			.addButton((b) => b.setButtonText('Forget saved settings').setDisabled(!s.defaults).onClick(async () => { s.defaults = null; await this.plugin.saveSettings(); this.render(); }));
		new Setting(containerEl)
			.setName(TEXT.sample[0])
			.setDesc(TEXT.sample[1])
			.addButton((b) => b.setButtonText('Open the sample').onClick(() => { void this.plugin.createSample(); }));

		new Setting(containerEl).setName('File format compatibility').setHeading();
		new Setting(containerEl)
			.setName('Enable legacy timeline compatibility')
			.setDesc('Allow Ouroboros Timelines to recognise, open and edit legacy Evra .evra timeline files.')
			.addToggle((t) => t.setValue(s.evraCompatibility).onChange(async (v) => {
				s.evraCompatibility = v; await this.plugin.saveSettings();
				new Notice('Reload Obsidian to apply the file-format registration change.');
			}));
	}
}
