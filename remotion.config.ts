import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(96);
Config.setOverwriteOutput(true);
Config.setPublicDir('public');
Config.setEntryPoint('src/index.ts');
Config.setChromiumDisableWebSecurity(false);
