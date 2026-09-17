import type Hexo from 'hexo';
import { registerPlugin } from './hexo/register';

declare const hexo: Hexo;
registerPlugin(hexo);
