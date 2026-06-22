/**
 * Rewards tab — three sub-views via the same SegmentedControl pattern
 * used in Community:
 *   Wallet      points balance, expiring-soon alert, recent ledger entries,
 *               redeem-for-store-discount CTA, referral share
 *   Offers      partner offers grid + your active redemption codes
 *   Badges      unlocked vs locked achievements, progress bars
 */
import { useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBalance, getPointsHistory, listOffers, listMyRedemptions } from '@/lib/api/rewards';
import { getMyAchievements } from '@/lib/api/achievements';
import { SegmentedControl } from '@/lib/components/SegmentedControl';
import { useAuthStore } from '@/lib/stores/auth.store';
import { absUrl } from '@/lib/utils/imageUrl';
import { colors, fontFamily } from '@/lib/theme/tokens';

type Tab = 'wallet' | 'offers' | 'badges';

export default function Rewards() {
  const [tab, setTab] = useState<Tab>('wallet');
  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-3 pb-3">
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight">
          Rewards
        </Text>
        <View className="mt-3">
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'wallet', label: 'Wallet' },
              { value: 'offers', label: 'Offers' },
              { value: 'badges', label: 'Badges' },
            ]}
          />
        </View>
      </View>
      {tab === 'wallet' && <WalletView />}
      {tab === 'offers' && <OffersView />}
      {tab === 'badges' && <BadgesView />}
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* Wallet                                                          */
/* ─────────────────────────────────────────────────────────────── */
function WalletView() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;

  const balanceQ = useQuery({ queryKey: ['balance'],         queryFn: () => getBalance() });
  const historyQ = useQuery({ queryKey: ['points-history'],  queryFn: () => getPointsHistory(1).then(r => r.transactions) });

  const refreshing = balanceQ.isFetching || historyQ.isFetching;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={
        <RefreshControl
          tintColor={colors.green}
          refreshing={refreshing}
          onRefresh={() => {
            qc.invalidateQueries({ queryKey: ['balance'] });
            qc.invalidateQueries({ queryKey: ['points-history'] });
          }}
        />
      }
    >
      {/* Balance card */}
      <View className="px-5 mt-3">
        <View className="rounded-atp-lg bg-atp-dark border border-white/5 p-5">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
            Your points
          </Text>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-5xl mt-1">
            {balanceQ.data ? balanceQ.data.balance.toLocaleString() : '—'}
          </Text>
          {!!balanceQ.data?.expiring_soon && balanceQ.data.expiring_soon > 0 && (
            <View className="mt-3 self-start bg-atp-dark-3 border border-warning/40 rounded-atp px-3 py-1.5">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-xs">
                ⏳ {balanceQ.data.expiring_soon.toLocaleString()} expiring in 30 days
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Redeem CTA */}
      <View className="px-5 mt-4">
        <Pressable
          onPress={() => router.push('/rewards/redeem')}
          className={`rounded-atp py-4 items-center ${(!balanceQ.data?.balance || balanceQ.data.balance < 280) ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          disabled={!balanceQ.data?.balance || balanceQ.data.balance < 280}
        >
          <Text
            style={{
              fontFamily: fontFamily.bodyBold,
              color: (!balanceQ.data?.balance || balanceQ.data.balance < 280) ? colors.muted : colors.black,
            }}
            className="text-base uppercase tracking-widest"
          >
            Redeem for store credit
          </Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-2">
          Minimum 280 points · 28 pts ≈ AED 0.10
        </Text>
      </View>

      {/* Ledger */}
      <View className="px-5 mt-7">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
          Recent activity
        </Text>
        {historyQ.isLoading ? (
          <ActivityIndicator color={colors.green} />
        ) : (historyQ.data || []).length === 0 ? (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
            No transactions yet. Book a session to earn your first points.
          </Text>
        ) : (
          (historyQ.data || []).slice(0, 15).map((tx) => (
            <View key={tx.id} className="flex-row items-center justify-between py-3 border-b border-white/5">
              <View className="flex-1 pr-3">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                  {tx.description || tx.reason}
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
                  {new Date(tx.created_at).toLocaleDateString()} · bal {tx.balance.toLocaleString()}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: fontFamily.displayBlack,
                  color: tx.amount >= 0 ? colors.green : colors.danger,
                }}
                className="text-lg"
              >
                {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Referral */}
      <View className="px-5 mt-7">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
          Earn more
        </Text>
        <Pressable
          onPress={() => {
            const code = me?.referral_code || me?.member_number;
            const url  = `https://atthepark.world/join?ref=${encodeURIComponent(code || '')}`;
            Share.share({ message: `Train with me at ATP — your first month of Premium is on me. ${url}` });
          }}
          className="bg-atp-dark border border-white/10 rounded-atp p-4 active:opacity-80"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm uppercase tracking-widest">
            Invite a friend
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
            +500 pts when they attend their first session.
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* Offers                                                          */
/* ─────────────────────────────────────────────────────────────── */
function OffersView() {
  const [filter, setFilter] = useState<'discount' | 'event' | 'promo' | undefined>();
  const offersQ = useQuery({
    queryKey: ['offers', filter],
    queryFn:  () => listOffers(filter).then(r => r.offers),
    staleTime: 1000 * 60 * 5,
  });
  const redeemedQ = useQuery({
    queryKey: ['my-redemptions'],
    queryFn:  () => listMyRedemptions().then(r => r.redemptions),
  });

  return (
    <FlatList
      ListHeaderComponent={
        <View className="px-3 pt-2 pb-3">
          <View className="px-2">
            <View className="flex-row gap-2">
              {([['discount','Discounts'], ['event','Events'], ['promo','Promo']] as const).map(([k, label]) => (
                <Pressable
                  key={k}
                  onPress={() => setFilter(filter === k ? undefined : k)}
                  className={`rounded-full px-4 py-2 border ${filter === k ? 'bg-atp-green border-atp-green' : 'bg-atp-dark border-white/10'}`}
                >
                  <Text
                    style={{ fontFamily: fontFamily.bodyBold, color: filter === k ? colors.black : colors.white }}
                    className="text-xs uppercase tracking-widest"
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {(redeemedQ.data || []).filter((r) => r.status === 'issued').length > 0 && (
            <View className="mt-4 px-2">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
                Your codes
              </Text>
              {(redeemedQ.data || []).filter((r) => r.status === 'issued').map((r) => (
                <View key={r.id} className="bg-atp-dark border border-white/5 rounded-atp p-3 mb-2 flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={1}>
                      {r.title}
                    </Text>
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
                      Expires {r.expires_at ? new Date(r.expires_at).toLocaleDateString() : 'never'}
                    </Text>
                  </View>
                  <View className="bg-atp-green/15 border border-atp-green/40 rounded-atp px-3 py-1.5">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm tracking-widest">
                      {r.code}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      }
      data={offersQ.data || []}
      keyExtractor={(o) => String(o.id)}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/rewards/offer/${item.id}`)}
          className="mx-5 mb-3 bg-atp-dark rounded-atp-lg border border-white/5 overflow-hidden active:opacity-70"
        >
          {!!item.image_url && (
            <Image
              source={{ uri: absUrl(item.image_url)! }}
              className="w-full"
              style={{ aspectRatio: 16 / 9, backgroundColor: colors.dark2 }}
              resizeMode="cover"
            />
          )}
          <View className="p-4">
            <View className="flex-row items-center gap-2 mb-1">
              {!!item.partner_name && (
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                  {item.partner_name}
                </Text>
              )}
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">
                · {item.offer_type}
              </Text>
            </View>
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase tracking-tight">
              {item.title}
            </Text>
            <View className="flex-row items-center gap-3 mt-2">
              {!!item.discount_pct && (
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-sm">
                  {item.discount_pct}% off
                </Text>
              )}
              {item.points_required != null && item.points_required > 0 && (
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">
                  {item.points_required} pts
                </Text>
              )}
              {!!item.event_date && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm">
                  {new Date(item.event_date).toLocaleDateString()}
                </Text>
              )}
            </View>
          </View>
        </Pressable>
      )}
      ListEmptyComponent={
        <View className="px-8 pt-12 items-center">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
            {offersQ.isLoading ? 'Loading offers…' : 'No offers right now. Check back soon.'}
          </Text>
        </View>
      }
      contentContainerStyle={{ paddingBottom: 80 }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* Badges                                                          */
/* ─────────────────────────────────────────────────────────────── */
function BadgesView() {
  const q = useQuery({ queryKey: ['achievements'], queryFn: () => getMyAchievements() });

  if (q.isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const data = q.data;
  const unlocked = data?.achievements.filter((a) => a.unlocked) || [];
  const locked   = data?.achievements.filter((a) => !a.unlocked) || [];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
      {data && (
        <View className="px-5 mt-3">
          <View className="bg-atp-dark border border-white/5 rounded-atp-lg p-4 flex-row items-center justify-between">
            <View>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
                Unlocked
              </Text>
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-2xl mt-0.5">
                {data.unlocked_count}/{data.achievements.length}
              </Text>
            </View>
            <View className="items-end">
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
                {data.stats.sessions} sessions · {data.stats.streak}-day streak
              </Text>
            </View>
          </View>
        </View>
      )}

      {unlocked.length > 0 && (
        <View className="px-5 mt-5">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
            Unlocked
          </Text>
          <View className="flex-row flex-wrap gap-3">
            {unlocked.map((a) => (
              <View key={a.id} className="w-[30%] bg-atp-dark border border-atp-green/40 rounded-atp p-3 items-center">
                <Text style={{ fontSize: 28 }}>{a.icon || '🏆'}</Text>
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs text-center mt-1" numberOfLines={2}>
                  {a.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {locked.length > 0 && (
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
            Keep going
          </Text>
          <View className="gap-2">
            {locked.map((a) => (
              <View key={a.id} className="bg-atp-dark border border-white/5 rounded-atp p-3">
                <View className="flex-row items-center gap-3">
                  <Text style={{ fontSize: 24, opacity: 0.4 }}>{a.icon || '🏆'}</Text>
                  <View className="flex-1">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                      {a.name}
                    </Text>
                    {!!a.description && (
                      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
                        {a.description}
                      </Text>
                    )}
                  </View>
                  {a.points_reward > 0 && (
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs">
                      +{a.points_reward}
                    </Text>
                  )}
                </View>
                <View className="mt-2.5">
                  <View className="h-1.5 bg-atp-dark-3 rounded-full overflow-hidden">
                    <View className="h-full bg-atp-green" style={{ width: `${a.progress_pct}%` }} />
                  </View>
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] mt-1">
                    {a.progress} / {a.criteria_value} {a.criteria_type}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
