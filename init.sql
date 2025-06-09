CREATE TABLE questions (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  correctAnswer VARCHAR(1) NOT NULL,
  category TEXT NOT NULL
);

CREATE TABLE game_sessions (
  id SERIAL PRIMARY KEY,
  userId VARCHAR(50) NOT NULL,
  cycleId VARCHAR(36) NOT NULL,
  bid FLOAT NOT NULL,
  raise FLOAT NOT NULL,
  winpercent FLOAT NOT NULL,
  priority_order VARCHAR(4),
  winnings FLOAT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    telegram_id BIGINT PRIMARY KEY,
    username VARCHAR(255) DEFAULT 'Unknown',
    kyc_status VARCHAR(20) DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'completed', 'rejected')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_telegram_id ON users (telegram_id);
CREATE INDEX idx_userId ON game_sessions (userId);

INSERT INTO questions (question, options, correctAnswer, category)
VALUES
  (
    'What is the capital of France?',
    '["A. Paris", "B. London", "C. Berlin", "D. Madrid"]'::jsonb,
    'A',
	'Geography'
  ),
  (
    'Which planet is known as the Red Planet?',
    '["A. Jupiter", "B. Mars", "C. Venus", "D. Mercury"]'::jsonb,
    'B',
	'Geography'
  );

INSERT INTO users (telegram_id, username, kyc_status) VALUES (1099402519, 'k09091989', 'completed');