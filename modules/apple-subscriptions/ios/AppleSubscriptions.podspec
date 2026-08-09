Pod::Spec.new do |s|
  s.name           = 'AppleSubscriptions'
  s.version        = '1.0.0'
  s.summary        = 'Pantrio StoreKit subscription bridge'
  s.description    = 'Loads plans, purchases with account tokens, and forwards signed StoreKit 2 evidence.'
  s.license        = { :type => 'MIT' }
  s.author         = 'Pantrio'
  s.homepage       = 'https://example.invalid'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'StoreKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
