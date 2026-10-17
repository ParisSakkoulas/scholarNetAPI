import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schema/user.schema';

import * as bcrypt from 'bcrypt';
import { UserStatus } from 'src/common/enums/user.status.enum';
import { UpdateUserInfoDto } from './dto/update-user.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { MailService } from '../mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import { RequestEmailDto } from './dto/update-email-user.dto';
import { MAX_LOGIN_ATTEMPTS, UNLOCK_TOKEN_TTL_MS, EMAIL_CHANGE_TOKEN_TTL_MS } from '../auth/constants/auth.constants';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel('User') private userModel: Model<User>,
    private emailService: MailService,
    private jwtService: JwtService,
    private configService: ConfigService,
    // private emailService: EmailService,
    private mailService: MailService,
    // @InjectModel('Profile') private profileModel: Model<Profile>,
  ) {}

  async create(createUserDto: CreateUserDto) {
    // 1. check if user exists
    const userExists = await this.userModel.findOne({
      $or: [{ email: createUserDto.email }, { username: createUserDto.username }],
    });

    if (userExists) {
      console.log(userExists);
      if (userExists.email === createUserDto.email) {
        throw new ConflictException('Email already in use');
      }
      throw new ConflictException('Username already taken');
    }

    // 2. hash passowrd
    const hashedPassword = await bcrypt.hash(createUserDto.password, 12);
    createUserDto.password = hashedPassword;

    // 3. create new user and save
    const createdUser = new this.userModel(createUserDto);

    // 4. create new profile and save
    return createdUser.save();
  }

  async findUserByField(fieldName: string, fieldValue: any) {
    const userFound = await this.userModel.findOne({ [fieldName]: fieldValue });
    return userFound;
  }

  async findUserById(id: string) {
    return this.userModel.findById(id);
  }

  async findUserByEmail(email: string) {
    const userFound = await this.userModel.findOne({ email: email });
    return userFound;
  }

  async activateUserAccount(userId: string): Promise<void> {
    await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        status: UserStatus.PENDING,
      },
      {
        $set: {
          status: UserStatus.ACTIVE,
          isEmailVerified: true,
          emailConfirmationToken: null,
          emailConfirmationExpires: null,
        },
      },
      { new: true },
    );
  }

  /**
   * Step 2 of the email change: the user clicked the link sent to the NEW address.
   * Only now does `email` actually change.
   */
  async confirmEmail(token: string) {
    const hashed = createHash('sha256').update(token).digest('hex');

    const user = await this.userModel
      .findOne({ emailChangeToken: hashed, emailChangeExpires: { $gt: new Date() } })
      .select('+emailChangeToken +emailChangeExpires');
    if (!user || !user.pendingEmail) {
      throw new BadRequestException('Invalid or expired confirmation link.');
    }

    const newEmail = user.pendingEmail;
    const oldEmail = user.email;

    // someone else may have taken this address since the request was made
    const taken = await this.userModel.exists({ email: newEmail, _id: { $ne: user._id } });
    if (taken) {
      await this.clearPendingEmail(user.id);
      throw new ConflictException('Email is already in use.');
    }

    user.email = newEmail;
    user.pendingEmail = null;
    user.emailChangeToken = null;
    user.emailChangeExpires = null;
    user.refreshToken = null as any; // force re-login on all devices
    try {
      await user.save();
    } catch (err: any) {
      if (err?.code === 11000) throw new ConflictException('Email is already in use.');
      throw err;
    }

    await this.mailService.sendEmailChangedNotice(oldEmail, user.firstName, newEmail);

    return { message: 'Email updated successfully. Please log in again.' };
  }

  private async clearPendingEmail(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: { pendingEmail: null, emailChangeToken: null, emailChangeExpires: null },
    });
  }

  async updatePassword(userId: string, dto: UpdatePasswordDto) {
    // 1. check passwords match
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match.');
    }

    // 2. find user
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');

    // 3. verify current password
    const isMatch = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isMatch) throw new UnauthorizedException('Current password is incorrect.');

    // 4. hash + save new password
    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.userModel.findByIdAndUpdate(userId, { password: hashed });

    return { message: 'Password updated successfully.' };
  }

  async setActivationToken(id: string, token: string, expires: Date): Promise<void> {
    await this.userModel.findByIdAndUpdate(id, {
      $set: {
        emailConfirmationToken: token,
        emailConfirmationExpires: expires,
      },
    });
  }

  findUserByEmailOrUserName(identifier: string) {
    console.log('identifier', identifier);

    return this.userModel.findOne({
      $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }],
    });
  }

  async updateUserInfo(userId: string, dto: UpdateUserInfoDto) {
    // check username uniqueness if provided
    if (dto.username) {
      const existing = await this.userModel.findOne({
        username: dto.username,
        _id: { $ne: userId }, // exclude current user
      });
      if (existing) throw new ConflictException('Username is already taken.');
    }

    const updated = await this.userModel
      .findByIdAndUpdate(userId, { $set: dto }, { new: true })
      .select('-password -refreshToken');

    if (!updated) throw new NotFoundException('User not found.');

    return updated;
  }

  /**
   * Step 1 of the email change: verify identity, park the new address as `pendingEmail`
   * and mail a one-time link to it. The current email stays active until it is confirmed;
   * a new request replaces any earlier pending one.
   */
  async requestEmailChange(userId: string, dto: RequestEmailDto) {
    const user = await this.userModel.findById(userId).select('+password');
    if (!user) throw new NotFoundException('User not found.');
    if (!user.password) {
      throw new BadRequestException('This account has no password; set one before changing email.');
    }

    const validPassword = await bcrypt.compare(dto.currentPassword, user.password);
    if (!validPassword) throw new UnauthorizedException('Current password is incorrect.');

    const newEmail = dto.newEmail.trim().toLowerCase();
    if (newEmail === user.email.toLowerCase()) {
      throw new BadRequestException('This is already your email address.');
    }

    const existing = await this.userModel.exists({ email: newEmail, _id: { $ne: userId } });
    if (existing) throw new ConflictException('Email is already in use.');

    const rawToken = randomBytes(32).toString('hex');
    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        pendingEmail: newEmail,
        emailChangeToken: createHash('sha256').update(rawToken).digest('hex'),
        emailChangeExpires: new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_MS),
      },
    });

    await this.mailService.sendEmailChangeConfirmation(newEmail, user.firstName, rawToken);

    return { message: 'Confirmation email sent to your new address.' };
  }

  async incrementLoginAttempts(userId: string) {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { loginAttempts: 1 } },
      { new: true },
    );

    if (!user || user.loginAttempts < MAX_LOGIN_ATTEMPTS) return;

    const rawToken = randomBytes(32).toString('hex');

    const locked = await this.userModel.findOneAndUpdate(
      { _id: userId, status: UserStatus.ACTIVE },
      {
        status: UserStatus.LOCKED,
        unlockToken: createHash('sha256').update(rawToken).digest('hex'),
        unlockTokenExpires: new Date(Date.now() + UNLOCK_TOKEN_TTL_MS),
      },
      { new: true },
    );

    if (!locked) return;

    await this.mailService.sendAccountLockedEmail(locked, rawToken);
  }

  async resetFailedAttempts(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, { loginAttempts: 0 });
  }

  async saveRefreshToken(userId: string, token: string | null) {
    await this.userModel.findByIdAndUpdate(userId, { refreshToken: token });
  }

  async findById(userId: string) {
    return this.userModel.findById(userId);
  }

  async setResetToken(userId: string, token: string, expires: Date) {
    await this.userModel.findByIdAndUpdate(userId, {
      passwordResetToken: token,
      passwordResetExpires: expires,
    });
  }

  async resetPassword(userId: string, hashedPassword: string) {
    await this.userModel.findByIdAndUpdate(userId, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
    });
  }

  async findByOAuthId(provider: string, id: string) {
    const field = provider === 'google' ? 'googleId' : 'orcidId';
    return this.userModel.findOne({ [field]: id });
  }

  async linkOAuthId(userId: string, provider: string, id: string) {
    const field = provider === 'google' ? 'googleId' : 'orcidId';
    const userUdated = await this.userModel.findByIdAndUpdate(userId, { [field]: id });
    console.log('userUpdated', userUdated);
  }

  async unlockAccount(rawToken: string) {
    const hashed = createHash('sha256').update(rawToken).digest('hex');

    return this.userModel.findOneAndUpdate(
      {
        unlockToken: hashed,
        unlockTokenExpires: { $gt: new Date() },
        status: UserStatus.LOCKED,
      },
      {
        status: UserStatus.ACTIVE,
        loginAttempts: 0,
        unlockToken: null,
        unlockTokenExpires: null,
      },
      { new: true },
    );
  }

  async createOAuthUser(oauthUser: {
    googleId?: string;
    orcidId?: string;
    email: string | null;
    firstName: string;
    lastName: string;
    profilePhotoUrl?: string;
  }) {
    const username = await this.generateUsername(oauthUser.firstName, oauthUser.lastName);

    const user = new this.userModel({
      ...oauthUser,
      username,
      password: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
      status: UserStatus.PENDING_PROFILE,
    });

    return user.save();
  }

  private async generateUsername(firstName: string, lastName: string): Promise<string> {
    const base = `${firstName}${lastName}`.toLowerCase().replace(/\s/g, '');
    let username = `_${base}`;
    let exists = await this.userModel.findOne({ username });
    while (exists) {
      username = `_${base}${Math.floor(Math.random() * 9999)}`;
      exists = await this.userModel.findOne({ username });
    }
    return username;
  }

  async usernameExists(username: string, excludeUserId?: string): Promise<boolean> {
    const query: any = { username };
    if (excludeUserId) query._id = { $ne: excludeUserId };
    const user = await this.userModel.findOne(query);
    return !!user;
  }

  async emailExists(email: string, excludeUserId?: string): Promise<boolean> {
    const query: any = { email };
    if (excludeUserId) query._id = { $ne: excludeUserId };
    const user = await this.userModel.findOne(query);
    return !!user;
  }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Finds active users for pickers such as the team invite box. Every word typed
   * must match the first name, last name or username ("jane do"), or the whole
   * text must match the email. The signed-in user is left out.
   */
  async search(q: string, excludeUserId?: string) {
    const term = q?.trim();
    if (!term) return [];

    const nameMatches = term.split(/\s+/).map((word) => {
      const rx = new RegExp(this.escapeRegex(word), 'i');
      return { $or: [{ firstName: rx }, { lastName: rx }, { username: rx }] };
    });
    const emailRx = new RegExp(this.escapeRegex(term), 'i');

    return this.userModel
      .find({
        status: UserStatus.ACTIVE,
        ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
        $or: [{ $and: nameMatches }, { email: emailRx }],
      })
      .limit(8)
      .select('username email firstName lastName profilePhotoUrl')
      .lean();
  }
}
