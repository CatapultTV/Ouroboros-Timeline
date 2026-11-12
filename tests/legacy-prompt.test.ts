import { shouldShowLegacyPrompt } from '../src/legacy-prompt';

const ok = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const decisions = { 'Old timeline.evra': 'keep' as const, 'Convert me.evra': 'ob' as const };

ok(shouldShowLegacyPrompt('evra', true, {}, 'New timeline.evra'), 'first open of an Evra file prompts');
ok(!shouldShowLegacyPrompt('evra', true, decisions, 'Old timeline.evra'), 'Keep Legacy Evra decision suppresses future prompts');
ok(!shouldShowLegacyPrompt('evra', true, decisions, 'Convert me.evra'), 'OB conversion decision suppresses future prompts');
ok(!shouldShowLegacyPrompt('ob', true, {}, 'Native timeline.ob'), 'native OB files never prompt');
ok(!shouldShowLegacyPrompt('evra', false, {}, 'Disabled.evra'), 'disabled compatibility never prompts');
ok(shouldShowLegacyPrompt('evra', true, undefined, 'Older settings.evra'), 'missing decision map is treated as no prior decision');
ok(shouldShowLegacyPrompt('evra', true, decisions, 'Different path/Old timeline.evra'), 'decisions are scoped to an individual file path');
console.log('legacy prompt: ok');
