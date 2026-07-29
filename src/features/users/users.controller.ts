import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserInfoDto } from './dto/update-user.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UsersService } from './users.service';
import { Query } from '@nestjs/common';

@Controller('users')
export class UsersController {
  constructor(private readonly userService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Patch('/me')
  @UseGuards(JwtAuthGuard)
  updateUserInfo(@CurrentUser() user, @Body() dto: UpdateUserInfoDto) {
    return this.userService.updateUserInfo(user.userId, dto);
  }

  @Get('check-username')
  async checkUsername(
    @Query('username') username: string,
    @Query('excludeUserId') excludeUserId?: string,
  ) {
    const exists = await this.userService.usernameExists(username, excludeUserId);
    return { exists };
  }

  @Get('check-email')
  async checkEmail(@Query('email') email: string, @Query('excludeUserId') excludeUserId?: string) {
    const exists = await this.userService.emailExists(email, excludeUserId);
    return { exists };
  }

  @Get(':id')
  async getSingleUser(@Param('id') id: string) {
    return this.userService.findUserById(id);
  }

  @Patch('/change-email')
  @UseGuards(JwtAuthGuard)
  updateEmail(@CurrentUser() user, @Body() dto: UpdateEmailDto) {
    return this.userService.updateEmail(user.userId, dto);
  }

  @Get('/confirm-email/:token')
  confirmEmail(@Param('token') token: string) {
    return this.userService.confirmEmail(token);
  }

  @Patch('/change-password')
  @UseGuards(JwtAuthGuard)
  updatePassword(@CurrentUser() user, @Body() dto: UpdatePasswordDto) {
    return this.userService.updatePassword(user.userId, dto);
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
