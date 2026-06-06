/**
 * 工具装配。按 scope 返回 ToolSet 给 ToolLoopAgent。
 * 工具职责与串联见文档 §7 / prompts.ts。summarize_period（按需摘要）后置。
 * buildBaseTools 为 10 个读/查工具；buildTools 在其上加 delegate_analysis（子 Agent，需 providerConfig）。
 * 子 Agent 复用 buildBaseTools（不含 delegate_analysis），避免递归委托。
 */
import type { ToolSet } from 'ai'
import type { AgentProviderConfig, AgentScope } from '../types'
import { withToolTimeouts } from '../guards'
import { listContacts } from './listContacts'
import { searchMessages } from './searchMessages'
import { semanticSearch } from './semanticSearch'
import { getContext } from './getContext'
import { getTimeline } from './getTimeline'
import { chatStats } from './chatStats'
import { listGroups } from './listGroups'
import { groupMembers } from './groupMembers'
import { groupMemberRanking } from './groupMemberRanking'
import { querySql } from './querySql'
import { createDelegateAnalysis } from './delegateAnalysis'

/** 基础读/查工具（不含 delegate_analysis），主 Agent 与子 Agent 共用。 */
export function buildBaseTools(_scope: AgentScope): ToolSet {
  return {
    list_contacts: listContacts,
    search_messages: searchMessages,
    semantic_search: semanticSearch,
    get_context: getContext,
    get_timeline: getTimeline,
    chat_stats: chatStats,
    list_groups: listGroups,
    group_members: groupMembers,
    group_member_ranking: groupMemberRanking,
    query_sql: querySql,
  }
}

export function buildTools(scope: AgentScope, providerConfig: AgentProviderConfig): ToolSet {
  return {
    ...buildBaseTools(scope),
    delegate_analysis: createDelegateAnalysis({
      providerConfig,
      scope,
      // 子 Agent 工具也套超时；用基础工具集避免再次委托
      buildSubTools: () => withToolTimeouts(buildBaseTools(scope)),
    }),
  }
}
