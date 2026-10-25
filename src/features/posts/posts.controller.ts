import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { parsePaging } from 'src/common/utils/paging';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  // ---------------- POSTS ----------------

  @Post()
  create(@CurrentUser() user, @Body() dto: CreatePostDto) {
    return this.postsService.create(user.userId, dto.content);
  }

  /** Main feed: posts from people I follow + my own. GET /posts/feed?page=1&limit=20 */
  @Get('feed')
  feed(@CurrentUser() user, @Query('page') page?: string, @Query('limit') limit?: string) {
    const p = parsePaging(page, limit);
    return this.postsService.getFeed(user.userId, p.page, p.limit, p.skip);
  }

  @Get('user/:userId')
  userPosts(
    @CurrentUser() user,
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parsePaging(page, limit);
    return this.postsService.getUserPosts(user.userId, userId, p.page, p.limit, p.skip);
  }

  @Get(':postId')
  getOne(@CurrentUser() user, @Param('postId') postId: string) {
    return this.postsService.getOne(user.userId, postId);
  }

  @Patch(':postId')
  edit(@CurrentUser() user, @Param('postId') postId: string, @Body() dto: CreatePostDto) {
    return this.postsService.edit(user.userId, postId, dto.content);
  }

  @Post(':postId/report')
  report(
    @CurrentUser() user,
    @Param('postId') postId: string,
    @Body('reason') reason: string,
    @Body('details') details?: string,
  ) {
    return this.postsService.report(user.userId, postId, reason, details);
  }

  @Delete(':postId')
  remove(@CurrentUser() user, @Param('postId') postId: string) {
    return this.postsService.remove(user.userId, postId);
  }

  // ---------------- LIKES ----------------

  @Post(':postId/like')
  like(
    @CurrentUser() user,
    @Param('postId') postId: string,
    @Body('type') type?: string,
  ) {
    return this.postsService.like(user.userId, postId, type);
  }

  @Delete(':postId/like')
  unlike(@CurrentUser() user, @Param('postId') postId: string) {
    return this.postsService.unlike(user.userId, postId);
  }

  // ---------------- COMMENTS ----------------

  @Post(':postId/comments')
  addComment(
    @CurrentUser() user,
    @Param('postId') postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.postsService.addComment(user.userId, postId, dto.content);
  }

  @Get(':postId/comments')
  comments(
    @Param('postId') postId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parsePaging(page, limit);
    return this.postsService.getComments(postId, p.page, p.limit, p.skip);
  }

  @Delete(':postId/comments/:commentId')
  removeComment(
    @CurrentUser() user,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.postsService.removeComment(user.userId, postId, commentId);
  }
}
