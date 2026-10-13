import {
  AUTHOR_MAX_POINTS,
  AUTHOR_MAX_ROUTE_STOPS,
  AUTHOR_MAX_YAML_BYTES,
} from '../../author/limits';
import type { AuthorIssue } from '../../author/types';

/** UI text never includes arbitrary parser messages, field paths or source values. */
export function friendlyAuthorIssues(issues: readonly AuthorIssue[]): string {
  return [
    ...new Set(
      issues.map((issue) => {
        let message = '请检查地图配置的格式与字段。';
        const syntax: Record<string, string> = {
          'YAML syntax is invalid': 'YAML 格式有误，请检查缩进与符号。',
          'YAML must contain only one document': '请只导入一个 YAML 文档。',
          'YAML mapping keys must be unique': '配置字段不能重复，请删除重复字段。',
          'YAML root must contain only the map field':
            '请只粘贴 map: 配置，不要包含文章正文或其他字段。',
          'YAML custom tags are not supported': '请使用普通 YAML 字段，不支持自定义标签。',
          'YAML merge and prototype keys are not supported':
            '请直接填写地图字段，不支持合并或特殊键名。',
          [`YAML must contain at most ${AUTHOR_MAX_YAML_BYTES} UTF-8 bytes`]:
            '配置内容过长，请精简地点名称或线路后重试。',
        };
        if (Object.hasOwn(syntax, issue.message)) message = syntax[issue.message]!;
        else if (issue.fieldPath === 'map.representative') message = '请选择全国地图代表地点。';
        else if (/^map\.route(?:\[\d+\])?$/u.test(issue.fieldPath))
          message =
            issue.message === `must contain at most ${AUTHOR_MAX_ROUTE_STOPS} stops`
              ? `线路最多支持 ${AUTHOR_MAX_ROUTE_STOPS} 次途经，请移除多余途经项。`
              : '线路需要至少两个有效途经地点；不需要线路时可移除全部途经项。';
        else if (issue.fieldPath === 'map.points')
          message =
            issue.message === `must contain at most ${AUTHOR_MAX_POINTS} points`
              ? `最多支持 ${AUTHOR_MAX_POINTS} 个地点，请减少地点数量。`
              : '请至少添加一个有效地点。';
        else if (/^map\.points\[\d+\]\.name$/u.test(issue.fieldPath))
          message = '请为地点填写名称。';
        else if (/^map\.points\[\d+\]\.longitude$/u.test(issue.fieldPath))
          message = '请填写 −180 到 180 之间的有效经度。';
        else if (/^map\.points\[\d+\]\.latitude$/u.test(issue.fieldPath))
          message = '请填写 −90 到 90 之间的有效纬度。';
        else if (/^map\.points\[\d+\]\.id$/u.test(issue.fieldPath))
          message = '地点标识应为互不重复的小写标识，请检查导入配置。';
        else if (issue.fieldPath === 'map.zoom') message = '文章缩放需要有效数字。';
        else if (issue.fieldPath === 'map.track.source')
          message = '轨迹来源需要本地 GPX、GeoJSON 或 JSON 文件的相对路径。';
        const location =
          Number.isSafeInteger(issue.line) &&
          issue.line! > 0 &&
          Number.isSafeInteger(issue.column) &&
          issue.column! > 0
            ? `（第 ${issue.line} 行，第 ${issue.column} 列）`
            : '';
        return message + location;
      }),
    ),
  ].join('；');
}
