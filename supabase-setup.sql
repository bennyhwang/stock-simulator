CREATE TABLE IF NOT EXISTS traders (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  cash_balance DECIMAL(18,2) NOT NULL DEFAULT 100000.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE traders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_traders" ON traders FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_traders" ON traders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_traders" ON traders FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS portfolios (
  id BIGSERIAL PRIMARY KEY,
  trader_id BIGINT NOT NULL REFERENCES traders(id),
  symbol TEXT NOT NULL,
  name TEXT,
  quantity BIGINT NOT NULL DEFAULT 0,
  avg_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
  UNIQUE(trader_id, symbol)
);
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_portfolios" ON portfolios FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  trader_id BIGINT NOT NULL REFERENCES traders(id),
  symbol TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity BIGINT NOT NULL,
  price DECIMAL(18,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_transactions" ON transactions FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS stock_prices (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_price DECIMAL(18,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO stock_prices (symbol, name, base_price) VALUES
  ('0005.HK', 'HSBC Holdings', 72.50),
  ('0700.HK', 'Tencent Holdings', 380.00),
  ('9988.HK', 'Alibaba Group', 95.20),
  ('0941.HK', 'China Mobile', 72.35),
  ('1299.HK', 'AIA Group', 65.80),
  ('3690.HK', 'Meituan', 185.50),
  ('1810.HK', 'Xiaomi Corp', 32.45),
  ('2388.HK', 'BOCHK', 28.90),
  ('0001.HK', 'CK Hutchison', 52.60),
  ('0011.HK', 'Hang Seng Bank', 112.30),
  ('AAPL', 'Apple Inc.', 195.00),
  ('GOOGL', 'Alphabet Inc.', 175.50),
  ('MSFT', 'Microsoft Corp.', 425.00),
  ('TSLA', 'Tesla Inc.', 245.80),
  ('AMZN', 'Amazon.com', 185.30),
  ('NVDA', 'NVIDIA Corp.', 890.00)
ON CONFLICT (symbol) DO NOTHING;
ALTER TABLE stock_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_stock_prices" ON stock_prices FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION register_trader(p_username TEXT, p_password TEXT)
RETURNS TABLE(username TEXT, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO traders (username, password_hash, display_name, cash_balance)
  VALUES (p_username, p_password, p_username, 100000.00);
  RETURN QUERY SELECT p_username, p_username;
END;
$$;
GRANT EXECUTE ON FUNCTION register_trader TO anon;

CREATE OR REPLACE FUNCTION login_trader(p_username TEXT, p_password TEXT)
RETURNS TABLE(username TEXT, display_name TEXT, cash_balance DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT t.username, t.display_name, t.cash_balance
  FROM traders t
  WHERE t.username = p_username AND t.password_hash = p_password;
END;
$$;
GRANT EXECUTE ON FUNCTION login_trader TO anon;

CREATE OR REPLACE FUNCTION search_stock(p_query TEXT)
RETURNS TABLE(symbol TEXT, name TEXT, price DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_symbol TEXT;
  v_name TEXT;
  v_base DECIMAL;
  v_random DECIMAL;
BEGIN
  FOR v_symbol, v_name, v_base IN
    SELECT sp.symbol, sp.name, sp.base_price
    FROM stock_prices sp
    WHERE sp.symbol ILIKE '%' || p_query || '%' OR sp.name ILIKE '%' || p_query || '%'
    LIMIT 10
  LOOP
    v_random := 1.0 + (random() - 0.5) * 0.1;
    symbol := v_symbol;
    name := v_name;
    price := ROUND(v_base * v_random, 2);
    RETURN NEXT;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION search_stock TO anon;

CREATE OR REPLACE FUNCTION execute_trade(
  p_username TEXT, p_symbol TEXT, p_name TEXT,
  p_price DECIMAL, p_quantity BIGINT, p_type TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
  v_cash DECIMAL(18,2);
  v_cost DECIMAL(18,2);
  v_held BIGINT;
BEGIN
  SELECT id, cash_balance INTO v_trader_id, v_cash FROM traders WHERE username = p_username;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF p_type = 'buy' THEN
    v_cost := p_price * p_quantity;
    IF v_cash < v_cost THEN RETURN 'insufficient_funds'; END IF;
    UPDATE traders SET cash_balance = cash_balance - v_cost WHERE id = v_trader_id;
    INSERT INTO portfolios (trader_id, symbol, name, quantity, avg_cost)
    VALUES (v_trader_id, p_symbol, p_name, p_quantity, p_price)
    ON CONFLICT (trader_id, symbol) DO UPDATE SET
      quantity = portfolios.quantity + p_quantity,
      avg_cost = ROUND((portfolios.avg_cost * portfolios.quantity + p_price * p_quantity)::numeric / (portfolios.quantity + p_quantity), 2);
    INSERT INTO transactions (trader_id, symbol, name, type, quantity, price)
    VALUES (v_trader_id, p_symbol, p_name, 'buy', p_quantity, p_price);
    RETURN 'ok';

  ELSIF p_type = 'sell' THEN
    SELECT quantity INTO v_held FROM portfolios WHERE trader_id = v_trader_id AND symbol = p_symbol;
    IF NOT FOUND OR v_held < p_quantity THEN RETURN 'no_shares'; END IF;
    UPDATE traders SET cash_balance = cash_balance + (p_price * p_quantity) WHERE id = v_trader_id;
    UPDATE portfolios SET quantity = quantity - p_quantity
    WHERE trader_id = v_trader_id AND symbol = p_symbol;
    DELETE FROM portfolios WHERE trader_id = v_trader_id AND symbol = p_symbol AND quantity <= 0;
    INSERT INTO transactions (trader_id, symbol, name, type, quantity, price)
    VALUES (v_trader_id, p_symbol, p_name, 'sell', p_quantity, p_price);
    RETURN 'ok';
  END IF;
  RETURN 'invalid_type';
END;
$$;
GRANT EXECUTE ON FUNCTION execute_trade TO anon;

CREATE OR REPLACE FUNCTION get_trader_summary(p_username TEXT)
RETURNS TABLE(cash DECIMAL, market_value DECIMAL, total_pnl DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
BEGIN
  SELECT id INTO v_trader_id FROM traders WHERE username = p_username;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    t.cash_balance AS cash,
    COALESCE(SUM(p.quantity * (SELECT ROUND(sp.base_price * (1.0 + (random() - 0.5) * 0.1), 2) FROM stock_prices sp WHERE sp.symbol = p.symbol)), 0) AS market_value,
    COALESCE(SUM(p.quantity * (SELECT ROUND(sp.base_price * (1.0 + (random() - 0.5) * 0.1), 2) FROM stock_prices sp WHERE sp.symbol = p.symbol) - p.avg_cost), 0) AS total_pnl
  FROM traders t
  LEFT JOIN portfolios p ON p.trader_id = t.id
  WHERE t.id = v_trader_id
  GROUP BY t.cash_balance;
END;
$$;
GRANT EXECUTE ON FUNCTION get_trader_summary TO anon;

CREATE OR REPLACE FUNCTION get_trader_portfolio(p_username TEXT)
RETURNS TABLE(symbol TEXT, name TEXT, quantity BIGINT, avg_cost DECIMAL, market_price DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
BEGIN
  SELECT id INTO v_trader_id FROM traders WHERE username = p_username;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.symbol, p.name, p.quantity, p.avg_cost,
    ROUND(sp.base_price * (1.0 + (random() - 0.5) * 0.1), 2) AS market_price
  FROM portfolios p
  JOIN stock_prices sp ON sp.symbol = p.symbol
  WHERE p.trader_id = v_trader_id AND p.quantity > 0
  ORDER BY p.symbol;
END;
$$;
GRANT EXECUTE ON FUNCTION get_trader_portfolio TO anon;

CREATE OR REPLACE FUNCTION get_trader_history(p_username TEXT, p_search TEXT DEFAULT NULL)
RETURNS TABLE(symbol TEXT, name TEXT, type TEXT, quantity BIGINT, price DECIMAL, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
BEGIN
  SELECT id INTO v_trader_id FROM traders WHERE username = p_username;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  SELECT t.symbol, t.name, t.type, t.quantity, t.price, t.created_at
  FROM transactions t
  WHERE t.trader_id = v_trader_id
    AND (p_search IS NULL OR t.symbol ILIKE '%' || p_search || '%')
  ORDER BY t.created_at DESC
  LIMIT 100;
END;
$$;
GRANT EXECUTE ON FUNCTION get_trader_history TO anon;
