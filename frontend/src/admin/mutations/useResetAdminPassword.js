import { useMutation } from '@tanstack/react-query'
import { adminRequest } from '../api'

export function useResetAdminPassword() {
  return useMutation({
    mutationFn: ({ username, newPassword }) => adminRequest(`/api/v1/platform/admin-users/${encodeURIComponent(username)}/password`, {
      method: 'POST',
      body: { new_password: newPassword },
    }),
  })
}
