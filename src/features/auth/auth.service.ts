import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { ResentVerificationLinkDto } from './dto/resend-link.dto';
import { UserLoginDto } from './dto/login.dto';
import { UserStatus } from 'src/common/enums/user.status.enum';
import * as bcrypt from 'bcrypt';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ProfileService } from '../profile/profile.service';
import { first } from 'rxjs';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private userService: UsersService,
    private mailService: MailService,
    private profileService: ProfileService,
    // @InjectModel('Profile') private profileModel: Model<Profile>,
  ) {}
  async register(registerDto: RegisterDto) {
    // 2. call create user from user service
    const createdUser = await this.userService.create(registerDto);

    // 2.1 create profile
    await this.profileService.createForUser(createdUser._id.toString());

    // 3. create token
    //create a token for the user
    const payload = { sub: createdUser._id, email: createdUser.email };
    // console.log(payload);
    const token = this.jwtService.sign(payload, { expiresIn: '1d' });
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 3. set token
    await this.userService.setActivationToken(createdUser._id.toString(), token, expires);

    // 4. send verification email
    // const activationLink = `http://localhost:4200/auth/verify-email/${token}`;

    await this.mailService.sendActivationEmail(createdUser.email, createdUser.firstName, token);

    // 5. response
    return 'Activation email has been sent to your email address. Please check your inbox and click the activation link to verify your account.';
  }

  async verifyEmail(token: string) {
    const user = await this.userService.findUserByField('emailConfirmationToken', token);

    if (!user) {
      throw new BadRequestException('Invalid or expired activation link');
    }

    await this.userService.activateUserAccount(user._id.toString());

    return {
      message: 'Account activated successfully. You can now log in.',
    };
  }

  async resendVerificationLink(resendVerificationLink: ResentVerificationLinkDto) {
    const user = await this.userService.findUserByField('email', resendVerificationLink.email);

    if (!user) {
      throw new BadRequestException('Invalid or expired activation link');
    }

    const payload = { sub: user._id, email: user.email };
    const token = this.jwtService.sign(payload, { expiresIn: '1d' });
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.userService.setActivationToken(user._id.toString(), token, expires);

    await this.mailService.sendActivationEmail(user.email, user.firstName, token);
    return 'Activation email has been sent to your email address. Please check your inbox and click the activation link to verify your account.';
  }

  async login(loginUserDto: UserLoginDto, res: Response) {
    console.log('Login DTO: ', loginUserDto);

    const user = await this.userService.findUserByEmailOrUserName(loginUserDto.identifier);

    if (!user) throw new UnauthorizedException('Invalid Crendetials');

    if (user.status === UserStatus.PENDING) {
      throw new UnauthorizedException('Please verify your email first.');
    }
    if (user.status === UserStatus.LOCKED) {
      throw new UnauthorizedException('Account is locked. Check your email.');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account has been suspended.');
    }

    // check password
    const isMatch = await bcrypt.compare(loginUserDto.password, user.password);
    if (!isMatch) {
      await this.userService.incrementLoginAttempts(user._id.toString());
      throw new UnauthorizedException('Invalid credentials.');
    }

    await this.userService.resetFailedAttempts(user._id.toString());

    const { accessToken, refreshToken } = this.generateTokens(user._id.toString(), user.email);

    const hashedRefresh = await bcrypt.hash(refreshToken, 10);
    await this.userService.saveRefreshToken(user._id.toString(), hashedRefresh);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      accessToken,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        status: user.status,
        role: user.role,
      },
    };
  }

  private generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  async refreshToken(req: Request, res: Response) {
    const token = req.cookies['refreshToken'];

    if (!token) throw new UnauthorizedException('No refresh token.');

    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    // validate against stored hash in DB
    const user = await this.userService.findById(payload.sub);
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const isMatch = await bcrypt.compare(token, user.refreshToken);
    if (!isMatch) throw new UnauthorizedException('Invalid refresh token.');

    // issue new tokens
    const { accessToken, refreshToken: newRefreshToken } = this.generateTokens(
      user._id.toString(),
      user.email,
    );

    const hashedRefresh = await bcrypt.hash(newRefreshToken, 10);
    await this.userService.saveRefreshToken(user._id.toString(), hashedRefresh);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { accessToken };
  }

  async forgotPassword(email: string) {
    const user = await this.userService.findUserByEmail(email);

    if (!user) {
      return { message: 'If this email is registered, you will receive a reset link.' };
    }

    const payload = { sub: user._id, email: user.email };
    const token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_RESET_SECRET'),
      expiresIn: '1h',
    });

    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await this.userService.setResetToken(user._id.toString(), token, expires);

    console.log('Sending an email');
    await this.mailService.sendResetPasswordEmail(user.email, user.firstName, token);

    return { message: 'If this email is registered, you will receive a reset link.' };
  }

  async logout(userId: string, res: Response) {
    await this.userService.saveRefreshToken(userId, null);

    res.cookie('refreshToken', '', {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: 0,
    });

    return { message: 'Logged out successfully.' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const user = await this.userService.findUserByField(
      'passwordResetToken',
      resetPasswordDto.token,
    );

    if (!user) {
      throw new BadRequestException('Invalid or expired reset link.');
    }

    if (user.passwordResetExpires < new Date()) {
      throw new BadRequestException('Reset link has expired. Please request a new one.');
    }

    if (resetPasswordDto.newPassword !== resetPasswordDto.confirmPassword) {
      throw new BadRequestException('Passwords do not match.');
    }

    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);
    await this.userService.resetPassword(user._id.toString(), hashedPassword);

    return { message: 'Password reset successfully. You can now log in.' };
  }

  async oauthLogin(
    oauthUser: {
      googleId: string;
      orcidId: string;
      email: string | null;
      firstName: string;
      lastName: string;
      profilePhotoUrl?: string;
      provider: string;
    },
    res: Response,
  ) {
    // 1. find existing user
    let user = await this.userService.findByOAuthId(oauthUser.provider, oauthUser.googleId);

    // 2. if not found by oauthId, try email (auto-link)
    if (!user && oauthUser.email) {
      user = await this.userService.findUserByField('email', oauthUser.email);
      if (user) {
        // link oauth id to existing account
        await this.userService.linkOAuthId(
          user._id.toString(),
          oauthUser.provider,
          oauthUser.googleId ?? oauthUser.orcidId,
        );
      }
    }

    // 3. if still not found → create new user
    if (!user) {
      user = await this.userService.createOAuthUser(oauthUser);
      await this.profileService.createForUser(user._id.toString());
    }

    // 4. generate tokens
    const { accessToken, refreshToken } = this.generateTokens(user._id.toString(), user.email);

    const hashedRefresh = await bcrypt.hash(refreshToken, 10);
    await this.userService.saveRefreshToken(user._id.toString(), hashedRefresh);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      accessToken,
      profileComplete: user.status !== UserStatus.PENDING_PROFILE,
      user: {
        id: user._id,
        email: user.email,
        status: user.status,
        role: user.role,
      },
    };
  }
}
