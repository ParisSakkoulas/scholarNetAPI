export enum PublicationType {
    JOURNAL_ARTICLE = 'journal_article',
    CONFERENCE_PAPER = 'conference_paper',
    BOOK = 'book',
    BOOK_CHAPTER = 'book_chapter',
    THESIS = 'thesis',
    TECHNICAL_REPORT = 'technical_report',
    PREPRINT = 'preprint',
    DATASET = 'dataset',
    PATENT = 'patent',
    OTHER = 'other',
}

export const PublicationTypeLabel: Record<PublicationType, string> = {
    [PublicationType.JOURNAL_ARTICLE]: 'Journal Article',
    [PublicationType.CONFERENCE_PAPER]: 'Conference Paper',
    [PublicationType.BOOK]: 'Book',
    [PublicationType.BOOK_CHAPTER]: 'Book Chapter',
    [PublicationType.THESIS]: 'Thesis',
    [PublicationType.TECHNICAL_REPORT]: 'Technical Report',
    [PublicationType.PREPRINT]: 'Preprint',
    [PublicationType.DATASET]: 'Dataset',
    [PublicationType.PATENT]: 'Patent',
    [PublicationType.OTHER]: 'Other',
};