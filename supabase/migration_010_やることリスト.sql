-- 暮らし帳 追加分10:家事 → やることリスト(期限・お休み・自分だけ・分類)
-- Supabase の SQL Editor に貼り付けて Run。何度実行しても大丈夫です。

alter table chores add column if not exists due date;                                   -- 期限(1回だけのとき。なくてもよい)
alter table chores add column if not exists archived boolean not null default false;    -- くり返しを終えた(お休み中)。「復活」で戻せる
alter table chores add column if not exists is_private boolean not null default false;  -- true なら作った本人だけ見える
alter table chores add column if not exists created_by uuid references auth.users(id) default auth.uid();
alter table chores add column if not exists category text not null default '家事';          -- 分類(家事・用事・手続き・買い物・仕事・お金・健康・その他)

-- 「自分だけ」のやることは本人以外に見せない(作った人が分からない古い分は、ふたりのもの)
drop policy if exists member_all on chores;
drop policy if exists chores_rw on chores;
create policy chores_rw on chores for all
  using (is_member(household_id) and (not is_private or created_by = auth.uid()))
  with check (is_member(household_id) and (not is_private or created_by = auth.uid()));

notify pgrst, 'reload schema';
