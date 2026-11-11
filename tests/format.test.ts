import { readTimeline, writeTimeline } from '../src/format';
import { sampleDoc, UnsupportedFile } from '../src/model';

const ok = (v: unknown, msg: string) => { if (!v) throw new Error(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const source = sampleDoc();
const native = readTimeline(JSON.parse(writeTimeline(source, 'ob')), 'Chronicle', 'ob');
ok(writeTimeline(native, 'ob').startsWith('{\n\t"format": "ob",\n\t"version": 1'), 'native writer header');
eq(native.events.map((e) => e.id), source.events.map((e) => e.id), 'native event IDs');
ok(readTimeline(JSON.parse(writeTimeline(native, 'ob')), 'Chronicle', 'ob').format === 'ob', 'native round trip');

const legacy = JSON.parse(writeTimeline(source, 'evra'));
ok(readTimeline(legacy, 'Chronicle', 'evra').format === 'evra', 'legacy reader');
ok(writeTimeline(readTimeline(legacy, 'Chronicle', 'evra'), 'evra').includes('"format": "evra"'), 'legacy writer');
// Conversion uses the shared reader and target writer; validate the target and compare every normalized field.
for (const [from, to] of [['evra', 'ob'], ['ob', 'evra']] as const) {
	const original = writeTimeline(source, from);
	const converted = writeTimeline(readTimeline(JSON.parse(original), 'Chronicle', from), to);
	const reopened = readTimeline(JSON.parse(converted), 'Chronicle', to);
	ok(JSON.parse(converted).format === to, `${from}-to-${to} target identifier`);
	const expected = readTimeline(JSON.parse(original), 'Chronicle', from);
	reopened.format = expected.format;
	eq(reopened, expected, `${from}-to-${to} data preserved`);
	ok(original === writeTimeline(readTimeline(JSON.parse(original), 'Chronicle', from), from), `${from}-to-${to} source remains unchanged`);
}

let refused = false;
try { readTimeline({ ...legacy, format: 'evra', version: 2 }, 'Chronicle', 'evra'); } catch (e) { refused = e instanceof UnsupportedFile; }
ok(refused, 'unsupported legacy files are refused');
console.log('format: ok');
