import type { DBStatement } from '@qqbot/sdk';

export function statement(sql: string, ...params: unknown[]): DBStatement {
    return { sql, params };
}

/** 编号查询的绑定参数不超过 D1 单条语句上限；超量输入也须经过正常操作流程
 * 持久化业务拒绝结果。 */
export function idChunks(ids: unknown[]): unknown[][] {
    const chunks: unknown[][] = [];

    for (let offset = 0; offset < ids.length; offset += 80) {
        chunks.push(ids.slice(offset, offset + 80));
    }

    return chunks;
}

export function placeholders(ids: unknown[]): string {
    return ids.map(() => '?').join(',');
}

// 来源最多七项操作权限；SDK 不开放 JSON 表函数，使用标量提取保持语义一致。
// 参数仅由内部固定列名和权限名提供，不接受外部 SQL 片段。
export function operationPermissionSql(permission: string): string {
    return '(' + Array.from({ length: 7 }, (_, index) =>
        `json_extract(s.operation_permissions,'$[${index}]')='${permission}'`).join(' OR ') + ')';
}
