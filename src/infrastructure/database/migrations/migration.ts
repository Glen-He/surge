/** 单个数据库迁移的稳定描述；迁移文件只依赖此类型，不反向依赖注册入口。 */
export type Migration = {
  version: number;
  name: string;
  statements: string[];
};
