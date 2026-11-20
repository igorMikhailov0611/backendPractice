import { Module } from '@nestjs/common';

import { ConfigModule } from '@/core/config/config.module';

import { mailTransportProvider } from './mail-transport.provider';
import { MailService } from './mail.service';

@Module({
  imports: [ConfigModule],
  providers: [mailTransportProvider, MailService],
  exports: [MailService],
})
export class MailModule {}
