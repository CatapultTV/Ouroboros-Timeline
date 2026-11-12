export type LegacyPromptDecision = 'keep' | 'ob';

/** Whether an Evra file should receive its one-time format-choice prompt. */
export function shouldShowLegacyPrompt(
	extension: string,
	compatibilityEnabled: boolean,
	decisions: Record<string, LegacyPromptDecision> | undefined,
	path: string,
): boolean {
	return compatibilityEnabled && extension === 'evra' && !decisions?.[path];
}
