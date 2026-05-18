import type { Utterance, SpeakerMapping } from '../database.types';
import type { UtteranceDiffItem } from './utteranceDiffEngine';

export interface SpeakerChangeRecord {
  utteranceId: string;
  startTime: number;
  endTime: number;
  fromSpeakerId: number;
  toSpeakerId: number;
  fromSpeakerName: string;
  toSpeakerName: string;
  riskLevel: 'low' | 'high';
}

/** Extract all speaker reassignment events from a diff list */
export function extractSpeakerChanges(
  diffs: UtteranceDiffItem[],
  speakerMappings: SpeakerMapping[],
): SpeakerChangeRecord[] {
  const nameMap = new Map(speakerMappings.map(m => [m.speaker_id, m.mapped_name]));
  const getName = (id: number) => nameMap.get(id) ?? `Speaker ${id}`;

  return diffs
    .filter(d => d.changeType === 'speaker_change' || (d.newSpeakerId !== null && d.speakerId !== d.newSpeakerId))
    .map(d => {
      const from = d.speakerId;
      const to = d.newSpeakerId ?? d.speakerId;
      const fromName = getName(from);
      const toName = getName(to);
      // Reassigning Q/A testimony is high-risk; reporter role changes are low
      const isTestimonySwap = !(/REPORTER|NOTARY|CLERK/i.test(fromName) || /REPORTER|NOTARY|CLERK/i.test(toName));
      return {
        utteranceId: d.utteranceId ?? '',
        startTime: d.startTime,
        endTime: d.endTime,
        fromSpeakerId: from,
        toSpeakerId: to,
        fromSpeakerName: fromName,
        toSpeakerName: toName,
        riskLevel: isTestimonySwap ? 'high' : 'low',
      } satisfies SpeakerChangeRecord;
    });
}

/** Return utterances whose speaker assignments differ between two snapshots */
export function diffSpeakerAssignments(
  source: Utterance[],
  target: Utterance[],
): { utteranceId: string; fromId: number; toId: number; startTime: number }[] {
  const targetMap = new Map(target.map(u => [u.sequence_index, u]));
  const changes: { utteranceId: string; fromId: number; toId: number; startTime: number }[] = [];
  for (const src of source) {
    const tgt = targetMap.get(src.sequence_index);
    if (tgt && tgt.speaker_id !== src.speaker_id) {
      changes.push({ utteranceId: src.id, fromId: src.speaker_id, toId: tgt.speaker_id, startTime: src.start_time });
    }
  }
  return changes;
}
