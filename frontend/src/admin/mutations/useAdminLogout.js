import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminRequest } from '../api'

const QUERY_KEYS_TO_CLEAR = [
  ['adminSession'],
  ['dashboardSummary'],
  ['workspaces'],
  ['adminUsers'],
  ['domains'],
  ['mailboxes'],
  ['aliases'],
  ['adminBindings'],
]

export function useAdminLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => adminRequest('/api/v1/platform/auth/logout', { method: 'POST' }),
    onSettled: async () => {
      await Promise.all(
        QUERY_KEYS_TO_CLEAR.map((queryKey) => queryClient.removeQueries({ queryKey })),
      )
    },
  })
}
