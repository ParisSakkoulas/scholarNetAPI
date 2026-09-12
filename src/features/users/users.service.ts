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
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { MailService } from '../mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { RequestEmailDto } from './dto/update-email-user.dto';

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

  async confirmEmail(token: string) {
    // 1. verify token
    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_VERIFICATION_SECRET'),
      });
    } catch {
      throw new BadRequestException('Invalid or expired confirmation link.');
    }

    // 2. find user
    const user = await this.userModel.findOne({
      _id: payload.sub,
      emailChangeToken: token,
    });
    if (!user) throw new BadRequestException('Invalid confirmation link.');

    // 3. check expiry
    if (user.emailChangeExpires < new Date()) {
      throw new BadRequestException('Confirmation link has expired.');
    }

    // 4. update email + clear pending fields
    await this.userModel.findByIdAndUpdate(payload.sub, {
      email: user.pendingEmail,
      pendingEmail: null,
      emailChangeToken: null,
      emailChangeExpires: null,
    });

    return { message: 'Email updated successfully.' };
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

  async updateEmail(userId: string, dto: UpdateEmailDto) {
    // 1. check if email already in use
    const existing = await this.userModel.findOne({
      email: dto.newEmail,
      _id: { $ne: userId },
    });
    if (existing) throw new ConflictException('Email is already in use.');

    // 2. generate verification token
    const token = this.jwtService.sign(
      { sub: userId, email: dto.newEmail },
      {
        secret: this.configService.get('JWT_VERIFICATION_SECRET'),
        expiresIn: '1d',
      },
    );
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 3. save pending email + token
    await this.userModel.findByIdAndUpdate(userId, {
      pendingEmail: dto.newEmail,
      emailChangeToken: token,
      emailChangeExpires: expires,
    });

    // 4. send confirmation email
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new ConflictException('Username not found');
    }
    await this.emailService.sendEmailChangeConfirmation(dto.newEmail, user.firstName, token);

    return { message: 'Confirmation email sent to your new address.' };
  }

  async incrementLoginAttempts(userId: string) {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { loginAttempts: 1 } },
      { new: true },
    );

    if (user && user.loginAttempts >= 5) {
      await this.userModel.findByIdAndUpdate(userId, {
        status: UserStatus.LOCKED,
      });
      // TODO: send unlock email
    }
  }

  async requestEmailChange(userId: string, dto: RequestEmailDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException();

    const validPassword = await bcrypt.compare(dto.currentPassword, user.password);
    if (!validPassword) throw new UnauthorizedException('Invalid password');

    const existing = await this.userModel.findOne({ email: dto.newEmail });
    if (existing) throw new ConflictException('Email already in use');

    const token = this.jwtService.sign(
      { sub: user._id, newEmail: dto.newEmail },
      { expiresIn: '30m', secret: process.env.EMAIL_CHANGE_SECRET },
    );

    await this.mailService.sendActivationEmail(dto.newEmail, user.firstName, token);

    return { message: 'Confirmation email sent' };
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
}
