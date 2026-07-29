import { Controller, Get, Post, Body, Patch, Param, Delete, Res, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { ResentVerificationLinkDto } from './dto/resend-link.dto';
import { UserLoginDto } from './dto/login.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Request, Response } from 'express';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleAuthGuard } from 'src/common/guards/google-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  async create(@Body() registerDto: RegisterDto) {
    await this.authService.register(registerDto);
    return { message: 'Activation email has been sent to your email address.' };
  }

  @Get('verify-email/:token')
  verifyEmail(@Param('token') token: string) {
    console.log("Token ", token)
    return this.authService.verifyEmail(token);
  }

  @Post('resend-verification-link')
  resendVerificationLink(@Body() resentLinkDto: ResentVerificationLinkDto) {
    return this.authService.resendVerificationLink(resentLinkDto);
  }


  @Post('login')
  login(@Body() dto: UserLoginDto, @Res({ passthrough: true }) res: Response) {
    return this.authService.login(dto, res);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('refresh')
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.refreshToken(req, res);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(user.userId, res);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }


  // --- GOOGLE ---
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleLogin() {
    // Guard redirects to Google — nothing to do here
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.oauthLogin(req.user as any, res);
  }





  //     @Get()
  //     findAll() {
  //         return this.authorsService.findAll();
  //     }

  //     @Get(':id')
  //     findOne(@Param('id') id: string) {
  //         return this.authorsService.findOne(+id);
  //     }

  //     @Patch(':id')
  //     update(@Param('id') id: string, @Body() updateAuthorDto: UpdateAuthorDto) {
  //         return this.authorsService.update(+id, updateAuthorDto);
  //     }

  //     @Delete(':id')
  //     remove(@Param('id') id: string) {
  //         return this.authorsService.remove(+id);
  //     }
}
