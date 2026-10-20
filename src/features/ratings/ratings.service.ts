import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Rating, RatingTarget } from './schemas/rating.schema';
import { Publication } from '../publications/schemas/publication.schema';
import { PublicationsService } from '../publications/publications.service';

export interface RatingSummary {
  average: number;
  count: number;
  /** The viewer's own rating, or null (also null for anonymous viewers). */
  mine: number | null;
}

@Injectable()
export class RatingsService {
  constructor(
    @InjectModel(Rating.name) private ratingModel: Model<Rating>,
    @InjectModel(Publication.name) private publicationModel: Model<Publication>,
    private publicationsService: PublicationsService,
  ) {}

  /** Reads the cached average/count from the target plus the viewer's own rating. */
  async getSummary(me: string | null, type: RatingTarget, targetId: string): Promise<RatingSummary> {
    this.assertTargetId(targetId);
    const [cached, mine] = await Promise.all([this.readCache(type, targetId), this.findMine(me, type, targetId)]);
    if (!cached) throw new NotFoundException(`${type} not found.`);
    return { ...cached, mine };
  }

  /** Creates or changes the viewer's rating. */
  async rate(me: string, type: RatingTarget, targetId: string, value: unknown) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
      throw new BadRequestException('Rating must be a whole number from 1 to 5.');
    }
    await this.assertCanRate(me, type, targetId);
    await this.ratingModel.updateOne(
      { targetType: type, target: targetId, rater: me },
      { $set: { value } },
      { upsert: true },
    );
    return this.refresh(me, type, targetId);
  }

  async remove(me: string, type: RatingTarget, targetId: string) {
    this.assertTargetId(targetId);
    await this.ratingModel.deleteOne({ targetType: type, target: targetId, rater: me });
    return this.refresh(me, type, targetId);
  }

  // ---------------- HELPERS ----------------

  /** Recounts from the ratings and writes the result onto the target so reads stay cheap. */
  private async refresh(me: string, type: RatingTarget, targetId: string): Promise<RatingSummary> {
    const [agg] = await this.ratingModel.aggregate<{ avg: number; n: number }>([
      { $match: { targetType: type, target: new Types.ObjectId(targetId) } },
      { $group: { _id: null, avg: { $avg: '$value' }, n: { $sum: 1 } } },
    ]);
    const average = agg ? Math.round(agg.avg * 100) / 100 : 0;
    const count = agg?.n ?? 0;

    await this.publicationModel.updateOne(
      { _id: targetId },
      { $set: { 'metrics.ratingAvg': average, 'metrics.ratingCount': count } },
    );
    return { average, count, mine: await this.findMine(me, type, targetId) };
  }

  private async findMine(me: string | null, type: RatingTarget, targetId: string) {
    if (!me) return null;
    const row = await this.ratingModel.findOne({ targetType: type, target: targetId, rater: me }).select('value').lean();
    return row?.value ?? null;
  }

  private async readCache(type: RatingTarget, targetId: string) {
    const pub = await this.publicationModel.findById(targetId).select('metrics.ratingAvg metrics.ratingCount').lean();
    return pub && { average: pub.metrics?.ratingAvg ?? 0, count: pub.metrics?.ratingCount ?? 0 };
  }

  private async assertCanRate(me: string, type: RatingTarget, targetId: string) {
    this.assertTargetId(targetId);
    await this.publicationsService.assertCanView(me, targetId);
    const pub = await this.publicationModel.findById(targetId).select('uploadedBy').lean();
    if (String(pub?.uploadedBy) === me) throw new ForbiddenException('You cannot rate your own publication.');
  }

  private assertTargetId(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid id.');
  }
}
