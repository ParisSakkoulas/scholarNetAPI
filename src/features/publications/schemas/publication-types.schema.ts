import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { PublicationType } from 'src/common/enums/publication-type.enum';
import { PublicationAuthor, PublicationAuthorSchema } from './publication.schema';

/**
 * One discriminator per publication type. They add the type-specific fields and
 * required-ness described in CLAUDE.md section 3; unknown fields are stripped by Mongoose.
 */

@Schema({ _id: false })
class DateRange {
  @Prop({ type: Date }) from?: Date;
  @Prop({ type: Date }) to?: Date;
}
const DateRangeSchema = SchemaFactory.createForClass(DateRange);

// ---------------- JOURNAL ARTICLE ----------------

@Schema()
export class JournalArticle {
  @Prop({ required: true, trim: true }) journalName!: string;
  @Prop() volume?: string;
  @Prop() issue?: string;
  @Prop() pages?: string;
  @Prop() articleNumber?: string;
  @Prop() publisher?: string;
  @Prop() peerReviewed?: boolean;
}
export const JournalArticleSchema = SchemaFactory.createForClass(JournalArticle);

// ---------------- CONFERENCE PAPER ----------------

@Schema()
export class ConferencePaper {
  @Prop({ required: true, trim: true }) conferenceName!: string;
  @Prop() location?: string;
  @Prop({ type: Date }) conferenceDate?: Date;
  @Prop() proceedingsTitle?: string;
  @Prop() pages?: string;
  @Prop() publisher?: string;
  @Prop({ type: String, enum: ['oral', 'poster', 'keynote', 'workshop'] })
  presentationType?: string;
}
export const ConferencePaperSchema = SchemaFactory.createForClass(ConferencePaper);

// ---------------- BOOK ----------------

@Schema()
export class Book {
  @Prop({ required: true, trim: true }) publisher!: string;
  @Prop() edition?: string;
  @Prop() series?: string;
  @Prop() numberOfPages?: number;
  @Prop({ type: [PublicationAuthorSchema], default: [] }) editors?: PublicationAuthor[];
}
export const BookSchema = SchemaFactory.createForClass(Book);

// ---------------- BOOK CHAPTER ----------------

@Schema()
export class BookChapter {
  @Prop({ required: true, trim: true }) bookTitle!: string;
  @Prop({ required: true, trim: true }) publisher!: string;
  @Prop({ type: [PublicationAuthorSchema], default: [] }) editors?: PublicationAuthor[];
  @Prop() pages?: string;
  @Prop() chapterNumber?: string;
  @Prop() edition?: string;
  @Prop() series?: string;
}
export const BookChapterSchema = SchemaFactory.createForClass(BookChapter);

// ---------------- THESIS ----------------

@Schema()
export class Thesis {
  @Prop({ type: String, required: true, enum: ['bachelor', 'master', 'phd', 'habilitation', 'other'] })
  degree!: string;
  @Prop({ required: true, trim: true }) institution!: string;
  @Prop() department?: string;
  @Prop({ type: [PublicationAuthorSchema], default: [] }) supervisors?: PublicationAuthor[];
  @Prop({ type: Date }) defenseDate?: Date;
}
export const ThesisSchema = SchemaFactory.createForClass(Thesis);

// ---------------- TECHNICAL REPORT ----------------

@Schema()
export class TechnicalReport {
  @Prop({ required: true, trim: true }) institution!: string;
  @Prop() reportNumber?: string;
  @Prop() sponsor?: string;
  @Prop() fundingAgency?: string;
  @Prop() grantNumber?: string;
}
export const TechnicalReportSchema = SchemaFactory.createForClass(TechnicalReport);

// ---------------- PREPRINT ----------------

@Schema()
export class Preprint {
  @Prop({
    type: String,
    required: true,
    enum: ['arxiv', 'biorxiv', 'medrxiv', 'ssrn', 'researchsquare', 'other'],
  })
  server!: string;
  @Prop() version?: number;
  @Prop({ type: String, enum: ['submitted', 'under_review', 'accepted', 'published'] })
  status?: string;
  /** The final published version, if any. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Publication', default: null })
  publishedVersion?: mongoose.Types.ObjectId | null;
}
export const PreprintSchema = SchemaFactory.createForClass(Preprint);

// ---------------- DATASET ----------------

@Schema()
export class Dataset {
  @Prop({ required: true, trim: true }) repository!: string;
  @Prop() version?: string;
  @Prop() format?: string;
  @Prop() sizeBytes?: number;
  @Prop({ type: DateRangeSchema }) collectionPeriod?: DateRange;
  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Publication' }], default: [] })
  relatedPublications?: mongoose.Types.ObjectId[];
}
export const DatasetSchema = SchemaFactory.createForClass(Dataset);

// ---------------- PATENT ----------------

@Schema()
export class Patent {
  @Prop({ required: true, trim: true }) patentOffice!: string;
  @Prop({ required: true, trim: true }) patentNumber!: string;
  @Prop({ type: [PublicationAuthorSchema], default: [] }) inventors?: PublicationAuthor[];
  @Prop() assignee?: string;
  @Prop({ type: Date }) filingDate?: Date;
  @Prop({ type: Date }) grantDate?: Date;
  @Prop({ type: String, enum: ['pending', 'granted', 'expired', 'rejected'] })
  status?: string;
}
export const PatentSchema = SchemaFactory.createForClass(Patent);

// ---------------- OTHER ----------------

@Schema()
export class OtherPublication {
  @Prop() description?: string;
  /** Free-text label, e.g. "Poster", "Software". */
  @Prop() customType?: string;
}
export const OtherPublicationSchema = SchemaFactory.createForClass(OtherPublication);

/** Registered in the module as `discriminators`. */
export const PUBLICATION_DISCRIMINATORS = [
  { name: JournalArticle.name, schema: JournalArticleSchema, value: PublicationType.JOURNAL_ARTICLE },
  { name: ConferencePaper.name, schema: ConferencePaperSchema, value: PublicationType.CONFERENCE_PAPER },
  { name: Book.name, schema: BookSchema, value: PublicationType.BOOK },
  { name: BookChapter.name, schema: BookChapterSchema, value: PublicationType.BOOK_CHAPTER },
  { name: Thesis.name, schema: ThesisSchema, value: PublicationType.THESIS },
  { name: TechnicalReport.name, schema: TechnicalReportSchema, value: PublicationType.TECHNICAL_REPORT },
  { name: Preprint.name, schema: PreprintSchema, value: PublicationType.PREPRINT },
  { name: Dataset.name, schema: DatasetSchema, value: PublicationType.DATASET },
  { name: Patent.name, schema: PatentSchema, value: PublicationType.PATENT },
  { name: OtherPublication.name, schema: OtherPublicationSchema, value: PublicationType.OTHER },
];
