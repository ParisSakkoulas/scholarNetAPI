import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail';
import { UserSchema } from '../users/schema/user.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtStrategy } from 'src/common/strategies/jwt.strategy';
import { GoogleStrategy } from 'src/common/strategies/google.strategy';
import { ProfileModule } from '../profile/profile.module';

@Module({
  imports: [
    MailModule,
    ConfigModule,
    ProfileModule,
    MongooseModule.forFeature([{ name: 'User', schema: UserSchema }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        console.log('JWT SECRET:', secret);
        return {
          secret: secret!,
          signOptions: {
            expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '1d') as any,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UsersService, JwtStrategy, GoogleStrategy],
})
export class AuthModule { }
