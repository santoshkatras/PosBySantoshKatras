import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(
    helmet({
      // The web app is a different origin (port). same-origin would hide JSON from the browser.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: webOrigins(process.env.WEB_ORIGIN ?? 'http://localhost:4317'),
    credentials: true,
  });
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 4318);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();

function webOrigins(primary: string): string[] {
  const origins = new Set<string>([primary]);
  try {
    const url = new URL(primary);
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
      origins.add(url.origin);
    } else if (url.hostname === '127.0.0.1') {
      url.hostname = 'localhost';
      origins.add(url.origin);
    }
  } catch {
    origins.add('http://localhost:4317');
    origins.add('http://127.0.0.1:4317');
  }
  return [...origins];
}
