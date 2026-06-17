import os
import sys
import smtplib
from email.message import EmailMessage
import yfinance as yf
from datetime import datetime

# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------
SENDER_EMAIL = "anjo28mj@gmail.com"
SENDER_PASSWORD = os.environ.get("EMAIL_APP_PASSWORD")

# Dynamic recipient from GitHub Actions variable
ALERT_EMAIL = os.environ.get("ALERT_EMAIL", "anjo28mj@gmail.com")

SUBSCRIBERS = [
    email.strip() for email in ALERT_EMAIL.split(',') if email.strip()
]

# Tickers to summarize in the daily alert
WATCHLIST = ["^NSEI", "RELIANCE.NS", "TCS.NS", "AAPL", "MSFT"]

def fetch_market_summary():
    """Fetches end-of-day summary for the watchlist."""
    print("Fetching market data...")
    summary_lines = []
    
    for ticker in WATCHLIST:
        try:
            asset = yf.Ticker(ticker)
            data = asset.history(period="2d")
            
            if len(data) >= 2:
                prev_close = data['Close'].iloc[0]
                current_price = data['Close'].iloc[1]
                change = current_price - prev_close
                change_pct = (change / prev_close) * 100
                
                sign = "+" if change >= 0 else ""
                color = "green" if change >= 0 else "red"
                
                line = f"<li><strong>{ticker}</strong>: {current_price:.2f} <span style='color:{color};'>({sign}{change_pct:.2f}%)</span></li>"
                summary_lines.append(line)
            else:
                summary_lines.append(f"<li><strong>{ticker}</strong>: Data unavailable</li>")
        except Exception as e:
            print(f"Failed to fetch {ticker}: {e}")
            summary_lines.append(f"<li><strong>{ticker}</strong>: Error fetching data</li>")
            
    return "".join(summary_lines)

def fetch_volatility_alerts(threshold_pct=2.0):
    """Checks for sudden intraday volatility (>2%)."""
    print("Checking for high volatility...")
    alert_lines = []
    
    for ticker in WATCHLIST:
        try:
            asset = yf.Ticker(ticker)
            # Use 1d data with 5m intervals to detect intraday swings
            data = asset.history(period="1d", interval="5m")
            
            if len(data) > 0:
                day_open = data['Open'].iloc[0]
                current_price = data['Close'].iloc[-1]
                
                change = current_price - day_open
                change_pct = (change / day_open) * 100
                
                if abs(change_pct) >= threshold_pct:
                    sign = "+" if change >= 0 else ""
                    color = "green" if change >= 0 else "red"
                    line = f"<li><strong>{ticker}</strong>: {current_price:.2f} <span style='color:{color};'>({sign}{change_pct:.2f}%)</span> - HIGH VOLATILITY</li>"
                    alert_lines.append(line)
        except Exception as e:
            print(f"Failed to fetch {ticker}: {e}")
            
    return "".join(alert_lines) if alert_lines else None

def send_emails(subject, html_content):
    """Sends the HTML email to all subscribers."""
    if not SENDER_PASSWORD:
        print("ERROR: EMAIL_APP_PASSWORD environment variable is not set. Exiting.")
        return
        
    print(f"Sending emails to {len(SUBSCRIBERS)} subscribers...")
    
    try:
        # Connect to Gmail's SMTP server
        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        
        for recipient in SUBSCRIBERS:
            msg = EmailMessage()
            msg['Subject'] = subject
            msg['From'] = SENDER_EMAIL
            msg['To'] = recipient
            
            # Set email body to HTML
            msg.set_content("Please enable HTML to view this email.")
            msg.add_alternative(html_content, subtype='html')
            
            server.send_message(msg)
            print(f"Sent successfully to {recipient}")
            
        server.quit()
        print("All emails dispatched successfully.")
    except Exception as e:
        print(f"Failed to send emails: {e}")

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "summary"
    
    if mode == "volatility":
        print("Running Volatility Scanner...")
        volatility_html = fetch_volatility_alerts(threshold_pct=2.0)
        
        if volatility_html:
            subject = f"⚠️ AuraTrade Volatility Alert - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            email_html = f"""
            <html>
              <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
                <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; border-left: 4px solid #ef4444; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                  <h2 style="color: #ef4444; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">AuraTrade // Volatility Detected</h2>
                  <p style="color: #555;">Significant market movement has been detected in your watchlist (>2% swing).</p>
                  <ul style="list-style-type: none; padding-left: 0; line-height: 1.8;">
                    {volatility_html}
                  </ul>
                </div>
              </body>
            </html>
            """
            send_emails(subject, email_html)
        else:
            print("No high volatility detected. Staying silent.")
            
    else:
        print("Running Daily Market Summary...")
        market_data_html = fetch_market_summary()
        subject = f"AuraTrade Daily Market Alert - {datetime.now().strftime('%Y-%m-%d')}"
        email_html = f"""
        <html>
          <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
            <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
              <h2 style="color: #0284C7; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">AuraTrade // Market Summary</h2>
              <p style="color: #555;">Here is your automated market update.</p>
              <ul style="list-style-type: none; padding-left: 0; line-height: 1.8;">
                {market_data_html}
              </ul>
            </div>
          </body>
        </html>
        """
        send_emails(subject, email_html)
