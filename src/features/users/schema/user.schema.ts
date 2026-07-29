import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Schema as MongooseSchema } from 'mongoose';
import { Profile } from 'passport';
import { Role } from 'src/common/enums/roles.enum';
import { UserStatus } from 'src/common/enums/user.status.enum';

@Schema({
  timestamps: true,
})
export class User extends Document {
  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({
    required: true,
    unique: true,
    trim: true,
    match: /^_[a-zA-Z0-9_]*$/,
  })
  username: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ type: String, enum: Object.values(Role), default: Role.USER })
  role: Role;

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.PENDING,
  })
  status: UserStatus;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Profile' })
  profile: Profile;

  @Prop()
  emailConfirmationToken: string;

  @Prop()
  emailConfirmationExpires: Date;

  @Prop()
  passwordResetToken: string;

  @Prop()
  passwordResetExpires: Date;

  @Prop({ default: 0 })
  loginAttempts: number;

  @Prop()
  refreshToken: string;

  @Prop()
  pendingEmail: string;

  @Prop()
  emailChangeToken: string;

  @Prop()
  emailChangeExpires: Date;

  @Prop()
  profilePhotoUrl: string;

  @Prop()
  googleId?: string;

  @Prop()
  orcidId: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
