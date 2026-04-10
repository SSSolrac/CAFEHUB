import "./LoyaltyCard.css";

const TOTAL_STAMPS = 10;

function LoyaltyCard({ loyaltyData }) {
  const {
    stampCount = 0,
    availableRewards = [],
    customerName,
    recentActivity = []
  } = loyaltyData;

  const earnedStamps = Math.min(stampCount, TOTAL_STAMPS);

  return (
    <section className="loyalty-card" aria-label="Customer loyalty card">
      <div className="loyalty-card__header">
        <h2>Paws & Perks Loyalty Card</h2>
        <p>Earn 1 stamp per completed order.</p>
      </div>

      {customerName ? <p className="loyalty-card__customer">Hi {customerName}, welcome back.</p> : null}

      <div className="loyalty-card__progress-row">
        <p className="loyalty-card__progress">{earnedStamps} / {TOTAL_STAMPS} stamps</p>
        <p className="loyalty-card__remaining">
          {availableRewards.length
            ? `Rewards unlocked: ${availableRewards.map((reward) => reward.label).join(", ")}`
            : "Keep ordering to unlock rewards."}
        </p>
      </div>

      <div className="loyalty-card__milestones" aria-label="Available rewards">
        {availableRewards.length ? (
          availableRewards.map((reward) => (
            <p key={reward.id}>{reward.label} (requires {reward.requiredStamps} stamps)</p>
          ))
        ) : (
          <p>No rewards unlocked yet.</p>
        )}
      </div>

      <div className="loyalty-card__meta">
        {recentActivity.length ? (
          <ul>
            {recentActivity.map((entry) => (
              <li key={entry.id}>{entry.id} • {new Date(entry.earnedAt).toLocaleDateString()} • {entry.status} • +{entry.stampDelta} stamp</li>
            ))}
          </ul>
        ) : (
          <p>Your recent loyalty activity will appear here.</p>
        )}
      </div>
    </section>
  );
}

export default LoyaltyCard;
