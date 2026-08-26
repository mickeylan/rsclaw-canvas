import { builtinProviderDefinition } from './builtin-providers.mjs'

export function deleteProviderProfileRecord(database, id) {
  const provider = database
    .prepare('SELECT provider_type FROM provider_profiles WHERE id = ?')
    .get(id)
  if (!provider) throw new Error('供应商不存在')
  if (builtinProviderDefinition(provider.provider_type)) {
    throw new Error('系统内置供应商不可删除')
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    // Older databases may have created this foreign key without ON DELETE CASCADE.
    // Delete the owned model configuration explicitly so those installations can
    // still remove a provider while task and agent history remain untouched.
    database.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(id)
    const changed = database.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id).changes
    if (!changed) throw new Error('供应商删除失败')
    database.exec('COMMIT')
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
}
