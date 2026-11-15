/** Locale bundles for the custom-agent manager. */

/** Locale keys the manager renders. */
export type CustomAgentsKey =
  | 'open' | 'createTitle' | 'editTitle' | 'name' | 'namePlaceholder' | 'description' | 'descriptionPlaceholder'
  | 'instructions' | 'instructionsPlaceholder' | 'tools' | 'save' | 'cancel' | 'remove' | 'removeConfirm'
  | 'empty' | 'edit' | 'saved' | 'limitReached' | 'invalidInput' | 'conflict' | 'errorUnavailable' | 'charsUsed'

/** English copy. */
export const en: Record<CustomAgentsKey, string> = {
  open: 'New custom agent',
  createTitle: 'New custom agent',
  editTitle: 'Edit custom agent',
  name: 'Name',
  namePlaceholder: 'What is this agent called?',
  description: 'Description',
  descriptionPlaceholder: 'One sentence on what it is for',
  instructions: 'Instructions',
  instructionsPlaceholder: 'How should this agent behave?',
  tools: 'Tools',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Delete',
  removeConfirm: 'Delete this agent? Sessions already running keep their composition.',
  empty: 'No custom agents yet',
  edit: 'Edit',
  saved: 'Saved',
  limitReached: 'The limit of custom agents is reached',
  invalidInput: '{reason}',
  conflict: 'The agent changed elsewhere; reopen and retry',
  errorUnavailable: 'The custom-agent service is unavailable',
  charsUsed: '{used} / {limit} characters',
}

/** Russian copy. */
export const ru: Record<CustomAgentsKey, string> = {
  open: 'Свой агент',
  createTitle: 'Новый агент',
  editTitle: 'Правка агента',
  name: 'Название',
  namePlaceholder: 'Как назвать этого агента?',
  description: 'Описание',
  descriptionPlaceholder: 'Одно предложение — зачем он нужен',
  instructions: 'Инструкция',
  instructionsPlaceholder: 'Как агент должен себя вести?',
  tools: 'Инструменты',
  save: 'Сохранить',
  cancel: 'Отмена',
  remove: 'Удалить',
  removeConfirm: 'Удалить агента? Запущенные сессии сохранят свою композицию.',
  empty: 'Своих агентов пока нет',
  edit: 'Править',
  saved: 'Сохранено',
  limitReached: 'Достигнут лимит своих агентов',
  invalidInput: '{reason}',
  conflict: 'Агент изменён в другом окне; откройте заново и повторите',
  errorUnavailable: 'Сервис своих агентов недоступен',
  charsUsed: '{used} / {limit} символов',
}

/** Chinese copy. */
export const zh: Record<CustomAgentsKey, string> = {
  open: '自定义智能体',
  createTitle: '新建智能体',
  editTitle: '编辑智能体',
  name: '名称',
  namePlaceholder: '这个智能体叫什么？',
  description: '描述',
  descriptionPlaceholder: '一句话说明它的用途',
  instructions: '指令',
  instructionsPlaceholder: '这个智能体应该如何表现？',
  tools: '工具',
  save: '保存',
  cancel: '取消',
  remove: '删除',
  removeConfirm: '删除这个智能体？已在运行的会话会保留其组成。',
  empty: '还没有自定义智能体',
  edit: '编辑',
  saved: '已保存',
  limitReached: '已达自定义智能体数量上限',
  invalidInput: '{reason}',
  conflict: '该智能体已在其他窗口修改；请重新打开后重试',
  errorUnavailable: '自定义智能体服务不可用',
  charsUsed: '{used} / {limit} 个字符',
}
