export const supabase = {
  auth: {
    getSession: async () => ({
      data: {
        session: {
          user: {
            id: "local-user",
            email: "local@zhnote.local",
            is_anonymous: false,
          },
          access_token: "",
        },
      },
      error: null,
    }),
    signOut: async () => ({ error: null }),
  },
  from: () => ({
    select: () => ({
      eq: () => ({ single: async () => ({ data: null, error: null }) }),
    }),
  }),
};
