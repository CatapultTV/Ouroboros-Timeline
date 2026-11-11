import type { TimelineDoc } from './types';
import { checkFormat, checkObFormat, checkEvraFormat, normDoc, UnsupportedFile } from './model';

export type TimelineFormat = 'ob' | 'evra';

export function formatForExtension(extension: string): TimelineFormat | null {
	if (extension === 'ob') return 'ob';
	if (extension === 'evra') return 'evra';
	return null;
}

export function readTimeline(raw: unknown, fallbackName: string, format: TimelineFormat): TimelineDoc {
	if (format === 'ob') {
		checkObFormat(raw);
		return normDoc(raw, fallbackName, 'ob');
	}
	checkEvraFormat(raw);
	return normDoc(raw, fallbackName, 'evra');
}

export function writeTimeline(doc: TimelineDoc, format: TimelineFormat): string {
	const raw = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
	// The in-memory model is shared by both formats; the target writer owns the header.
	delete raw.format;
	delete raw.version;
	const normalized = normDoc(raw, doc.name || 'Untitled', format);
	return JSON.stringify({ format, version: 1, ...normalized }, null, '\t');
}

export function parseTimeline(data: string, fallbackName: string, format: TimelineFormat): TimelineDoc {
	try { return readTimeline(JSON.parse(data), fallbackName, format); }
	catch (e) { if (e instanceof UnsupportedFile) throw e; throw e; }
}

/** Kept as a small compatibility surface for callers that still use the old model validator. */
export { checkFormat };
