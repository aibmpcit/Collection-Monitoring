CREATE DATABASE IF NOT EXISTS collection_monitoring
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE collection_monitoring;

CREATE TABLE IF NOT EXISTS branches (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_branches_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin', 'branch_admin', 'staff') NOT NULL,
  branch_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_users_username (username), KEY idx_users_branch (branch_id),
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS borrowers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cif_key VARCHAR(50) NULL,
  branch_id INT UNSIGNED NULL,
  member_name VARCHAR(120) NULL,
  contact_info VARCHAR(80) NULL,
  address VARCHAR(255) NULL,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_borrowers_cif (cif_key), KEY idx_borrowers_branch (branch_id),
  CONSTRAINT fk_borrowers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS loans (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  borrower_id INT UNSIGNED NOT NULL,
  loan_account_no VARCHAR(60) NULL,
  loan_type VARCHAR(80) NULL,
  date_release DATE NULL,
  maturity_date DATE NULL,
  loan_amount DECIMAL(12,2) NULL,
  loan_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  principal_due DECIMAL(12,2) NULL,
  penalty_due DECIMAL(12,2) NULL,
  other_charges DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  par_age INT NOT NULL DEFAULT 0,
  notes TEXT NULL,
  principal DECIMAL(12,2) NOT NULL,
  interest DECIMAL(12,2) NOT NULL,
  penalty DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  status ENUM('active', 'closed', 'overdue') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_loans_account (loan_account_no), KEY idx_loans_borrower (borrower_id),
  CONSTRAINT fk_loans_borrower FOREIGN KEY (borrower_id) REFERENCES borrowers(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(190) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS collections (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  loan_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  or_no VARCHAR(80) NULL,
  collected_at DATETIME NOT NULL,
  created_by INT UNSIGNED NULL,
  PRIMARY KEY (id), KEY idx_collections_loan (loan_id), KEY idx_collections_user (created_by),
  CONSTRAINT fk_collections_loan FOREIGN KEY (loan_id) REFERENCES loans(id),
  CONSTRAINT fk_collections_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS loan_remarks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  loan_id INT UNSIGNED NOT NULL,
  remark_text TEXT NOT NULL,
  remark_category VARCHAR(64) NOT NULL DEFAULT 'follow_up_collection',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_loan_remarks_loan (loan_id),
  CONSTRAINT fk_loan_remarks_loan FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
  CONSTRAINT fk_loan_remarks_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS borrower_remarks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  borrower_id INT UNSIGNED NOT NULL,
  remark_text TEXT NOT NULL,
  remark_category VARCHAR(64) NOT NULL DEFAULT 'follow_up_collection',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_borrower_remarks_borrower (borrower_id),
  CONSTRAINT fk_borrower_remarks_borrower FOREIGN KEY (borrower_id) REFERENCES borrowers(id) ON DELETE CASCADE,
  CONSTRAINT fk_borrower_remarks_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS remark_attachments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  remark_kind VARCHAR(16) NOT NULL,
  remark_id INT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_data LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_remark_attachment (remark_kind, remark_id)
) ENGINE=InnoDB;
