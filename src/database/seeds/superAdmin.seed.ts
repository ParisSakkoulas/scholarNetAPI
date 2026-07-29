// import { NestFactory } from '@nestjs/core';
// import { AppModule } from '../app.module';
// import { getModelToken } from '@nestjs/mongoose';
// import { Model } from 'mongoose';
// import * as bcrypt from 'bcrypt';
// import { User, UserDocument, UserRole } from '../user/user.schema';

// async function seed() {
//   const app = await NestFactory.createApplicationContext(AppModule);
//   const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));

//   const email = 'superadmin@eshop.com';

//   const existing = await userModel.findOne({ email });
//   if (existing) {
//     console.log('SuperAdmin already exists');
//     await app.close();
//     return;
//   }

//   await userModel.create({
//     firstName: 'Super',
//     lastName: 'Admin',
//     email,
//     password: await bcrypt.hash('SuperAdmin123!', 12),
//     role: UserRole.SUPER_ADMIN,
//     isActive: true,
//   });

//   console.log('   email:    superadmin@eshop.com');
//   console.log('   password: SuperAdmin123!');

//   await app.close();
// }

// seed();
