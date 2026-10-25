export interface MilestoneTemplateStep {
  title: string;
  description: string;
  /** Weeks after the start date. */
  weeks: number;
}

export const MILESTONE_TEMPLATES: Record<string, MilestoneTemplateStep[]> = {
  thesis: [
    { title: 'Proposal', description: 'Research question, scope and plan agreed.', weeks: 4 },
    { title: 'Literature review', description: 'State of the art and gaps identified.', weeks: 12 },
    { title: 'Data collection', description: 'Experiments, interviews or data gathering done.', weeks: 24 },
    { title: 'Draft chapters', description: 'Full draft ready for supervisor feedback.', weeks: 36 },
    { title: 'Submission', description: 'Final thesis submitted.', weeks: 44 },
  ],
};
